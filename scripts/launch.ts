#!/usr/bin/env tsx
/**
 * `npm run launch -- --server <name> [--preflight] [--resume] [--admin-created] [--two-factor-on] [--json]`
 *
 * Reads servers/<name>.yaml and .env.<name>, runs the preflight, creates the
 * server with Pulumi, and runs Phase B to the server block: Phase A finished,
 * the tailnet node verified, the SSH grant proved, the admin account created
 * by the person, the env file, the skills, the lane firewall, the probe, and
 * the block written to servers/<name>.block.txt.
 *
 * `--resume` skips `pulumi up` and runs Phase B again from its first step.
 * When this computer can find the server on the tailnet it goes over Tailscale
 * SSH, so it works after port 22 has closed. Every step can be run again: the
 * env file is never overwritten, the skills install is skipped once it has
 * happened, and the firewall rules are replaced as a whole.
 *
 * `--preflight` reads the spec and runs the checks on this computer and
 * `.env.<name>`, then stops. It creates nothing and spends nothing, so
 * /launch-server can show the person what is missing before it asks them to
 * agree to the cost.
 *
 * Running it without `--resume` is also safe. `pulumi up` changes nothing on a
 * server that exists, because the program ignores later changes to user-data.
 */
import { fileURLToPath } from "node:url";
import { loadSpec, envPath, type ServerSpec } from "../lib/spec.js";
import { REQUIRED_SECRETS, SECRETS_AFTER_LAUNCH, requireEnvFile, secretsForChild } from "../lib/env.js";
import { step, type OnProgress, type ProgressEvent } from "../lib/progress.js";
import { ensureStack, runPulumi, stackOutput, type PulumiContext } from "../lib/pulumi.js";
import { remote, withStagedKey, type SshTarget } from "../lib/ssh.js";
import { waitForPhaseA, verifyTailnet, proveSshGrant } from "../lib/phase-b.js";
import { fetchGithubHooks, HetznerApi, httpStatus, probePort } from "../lib/hetzner-firewall.js";
import { stoppedFor, writeHandOver } from "../lib/server-block.js";
import { chooseFirstLeg, phaseB, type PhaseBDeps, type PhaseBResult } from "../lib/launch-flow.js";
import { commandWorks, tailnetIpOf, tailscaleCommand, MAC_APP_TAILSCALE } from "../lib/local-tailscale.js";
import { makeProgressRenderer, renderStopped } from "./output.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const USAGE = "Usage: npm run launch -- --server <name> [--preflight] [--resume] [--admin-created] [--two-factor-on] [--json]";

interface Args {
    server: string;
    json: boolean;
    preflight: boolean;
    resume: boolean;
    adminCreated: boolean;
    twoFactorOn: boolean;
}

function parseArgs(argv: string[]): Args {
    let server: string | undefined;
    const flags = { json: false, preflight: false, resume: false, adminCreated: false, twoFactorOn: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--server") server = argv[++i];
        else if (a === "--json") flags.json = true;
        else if (a === "--preflight") flags.preflight = true;
        else if (a === "--resume") flags.resume = true;
        else if (a === "--admin-created") flags.adminCreated = true;
        else if (a === "--two-factor-on") flags.twoFactorOn = true;
        else throw new Error(`Unknown argument "${a}". ${USAGE}`);
    }
    if (!server) throw new Error(`Missing --server <name>. ${USAGE}`);
    if (flags.preflight && (flags.resume || flags.adminCreated || flags.twoFactorOn)) {
        throw new Error(`--preflight runs on its own. ${USAGE}`);
    }
    if (server === "example") {
        // servers/example.yaml and .env.example are the templates, both tracked.
        throw new Error("example is the template. Copy servers/example.yaml to servers/<name>.yaml and launch that name.");
    }
    return { server, ...flags };
}

/**
 * What a machine can check before anything is spent. The tailnet policy and
 * the kind of auth key cannot be read from here without a Tailscale API
 * credential the launchpad does not hold, so the skill asks the person about
 * them, and steps 2 and 3 prove them on the real node.
 */
function preflight(spec: ServerSpec, keys: readonly string[]): void {
    const problems: string[] = [];
    try {
        requireEnvFile(envPath(spec.name, repoRoot), keys);
    } catch (err) {
        problems.push((err as Error).message);
    }
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 20) problems.push(`Node ${process.versions.node} is too old; the launchpad needs Node 20 or newer.`);
    if (!commandWorks("pulumi", ["version"])) problems.push("The pulumi command is not on the path. Install the Pulumi CLI.");
    if (!commandWorks("ssh", ["-V"])) problems.push("The ssh command is not on the path.");
    const tailscale = tailscaleCommand();
    if (!tailscale) {
        problems.push(
            "No Tailscale command found on this computer: `tailscale` is not on the path" +
            (process.platform === "darwin" ? `, and there is no ${MAC_APP_TAILSCALE}` : "") +
            ". Install Tailscale here and sign in to the tailnet first.",
        );
    } else if (!commandWorks(tailscale, ["status"])) {
        problems.push("This computer is not on the tailnet: `tailscale status` failed. Sign in to Tailscale here first.");
    }
    if (problems.length > 0) throw new Error(problems.join("\n"));
}

/** The real SSH, Hetzner, GitHub and network calls. The token goes into the Hetzner client and nowhere else. */
function realDeps(hcloudToken: string): PhaseBDeps {
    return {
        waitForPhaseA: (leg) => waitForPhaseA(leg),
        verifyTailnet,
        proveSshGrant: (ip) => proveSshGrant(ip),
        remote,
        hetzner: new HetznerApi(hcloudToken),
        fetchGithubHooks: () => fetchGithubHooks(),
        probePort: (host, port) => probePort(host, port),
        httpStatus: (url) => httpStatus(url),
        writeHandOver: (server, text) => writeHandOver(server, repoRoot, text),
    };
}

/** The checks alone, for --preflight: nothing is created and nothing is spent. */
async function preflightOnly(args: Args, onProgress: OnProgress): Promise<void> {
    const spec = await step(onProgress, `Reading servers/${args.server}.yaml`, () => loadSpec(args.server, repoRoot));
    await step(onProgress, `Checking this computer and .env.${spec.name}`, () => preflight(spec, REQUIRED_SECRETS));
}

async function launch(args: Args, onProgress: OnProgress, markServerMayExist: () => void): Promise<PhaseBResult> {
    const spec = await step(onProgress, `Reading servers/${args.server}.yaml`, () => loadSpec(args.server, repoRoot));
    // A resume runs no `pulumi up`, so it never reads the auth key, which is
    // spent once the server has joined and may have been deleted.
    const keys = args.resume ? SECRETS_AFTER_LAUNCH : REQUIRED_SECRETS;
    await step(onProgress, `Checking this computer and .env.${spec.name}`, () => preflight(spec, keys));

    const secrets = secretsForChild(envPath(spec.name, repoRoot), keys);
    const ctx: PulumiContext = { repoRoot, server: spec.name, secrets };
    const deps = realDeps(secrets.HCLOUD_TOKEN);
    const flags = { adminCreated: args.adminCreated, twoFactorOn: args.twoFactorOn };

    let publicIp: string;
    if (args.resume) {
        markServerMayExist();
        publicIp = await step(
            onProgress,
            "Reading the server from the local Pulumi stack",
            () => stackOutput(ctx, "ipv4Address"),
            (ip) => `public IP ${ip}`,
        );
    } else {
        await step(onProgress, "Preparing the local Pulumi stack", () => ensureStack(ctx), (r) => r);
        markServerMayExist();
        publicIp = await step(
            onProgress,
            `Creating the server on Hetzner (${spec.hetzner.type}, ${spec.hetzner.location})`,
            () => {
                runPulumi(ctx, ["up", "--yes", "--skip-preview", "--stack", spec.name]);
                return stackOutput(ctx, "ipv4Address");
            },
            (ip) => `public IP ${ip}`,
        );
    }
    const serverId = Number(stackOutput(ctx, "serverId"));

    // On a resume the node is looked up on the tailnet, so port 22 may already
    // be closed; Phase B then checks that the machine it found is this server.
    // Otherwise leg one: the public IP with the key Pulumi made.
    const first = await step(
        onProgress,
        "Choosing how to reach the server",
        () => chooseFirstLeg(args.resume, spec.name, publicIp, { tailnetIpOf, probePort }),
        (l) => (l.kind === "tailnet" ? `over the tailnet at ${l.host}` : `over port 22 at ${publicIp}`),
    );
    if (first.kind === "tailnet") {
        return phaseB({ spec, publicIp, serverId, firstLeg: { host: first.host, user: "root" }, ...flags }, deps, onProgress);
    }
    const privateKey = stackOutput(ctx, "privateKey", true);
    return withStagedKey(privateKey, (keyPath) => {
        const leg1: SshTarget = { host: publicIp, user: "root", keyPath };
        return phaseB({ spec, publicIp, serverId, firstLeg: leg1, ...flags }, deps, onProgress);
    });
}

async function main(): Promise<void> {
    let args: Args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error((err as Error).message);
        process.exit(2);
    }
    const render = makeProgressRenderer(args.json);
    let reached = "nothing yet";
    let serverMayExist = false;
    const onProgress = (e: ProgressEvent) => {
        if (e.status === "done") reached = e.step;
        render(e);
    };
    try {
        if (args.preflight) {
            await preflightOnly(args, onProgress);
            const ready = `Ready to launch ${args.server}. Nothing was created and nothing was spent.`;
            if (args.json) process.stdout.write(JSON.stringify({ type: "result", status: "ready", detail: ready }) + "\n");
            else process.stdout.write(`\n${ready}\n`);
            return;
        }
        const result = await launch(args, onProgress, () => (serverMayExist = true));
        if (args.json) {
            process.stdout.write(
                JSON.stringify({ type: "result", status: "launched", block: result.text, stillYours: result.stillYours, path: result.path }) + "\n",
            );
        } else {
            process.stdout.write(`\n${result.text}\n\nWritten to ${result.path}\n`);
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stopped = stoppedFor(err, reached, args.server, serverMayExist);
        if (args.json) {
            process.stdout.write(JSON.stringify({ type: "result", status: "stopped", ...stopped, detail: message }) + "\n");
        } else {
            process.stdout.write(`\n${renderStopped(stopped)}\n`);
            const rest = message.split("\n").slice(1).join("\n");
            if (rest) process.stdout.write(`\n${rest}\n`);
        }
        process.exit(1);
    }
}

void main();
