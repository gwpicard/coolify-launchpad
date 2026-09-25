#!/usr/bin/env tsx
/**
 * `npm run launch -- --server <name> [--json]`
 *
 * Reads servers/<name>.yaml and .env.<name>, runs the preflight, creates the
 * server with Pulumi, waits for Phase A, verifies the tailnet node, and proves
 * the SSH grant from this computer. It stops there: Phase B's later steps
 * (the admin account, the env file, the skills install, the lane firewall,
 * the probe and the server block) arrive in a later version.
 *
 * Running it again is safe. `pulumi up` changes nothing on a server that
 * exists, and every step after it only reads.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSpec, envPath, type ServerSpec } from "../lib/spec.js";
import { requireEnvFile, secretsForChild } from "../lib/env.js";
import { step, type OnProgress, type ProgressEvent } from "../lib/progress.js";
import { ensureStack, runPulumi, stackOutput, type PulumiContext } from "../lib/pulumi.js";
import { withStagedKey, type SshTarget } from "../lib/ssh.js";
import { waitForPhaseA, verifyTailnet, proveSshGrant } from "../lib/phase-b.js";
import { makeProgressRenderer, renderStopped, renderGrantProved } from "./output.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface Args {
    server: string;
    json: boolean;
}

function parseArgs(argv: string[]): Args {
    let server: string | undefined;
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--server") server = argv[++i];
        else if (a === "--json") json = true;
        else throw new Error(`Unknown argument "${a}". Usage: npm run launch -- --server <name> [--json]`);
    }
    if (!server) throw new Error("Missing --server <name>. Usage: npm run launch -- --server <name> [--json]");
    if (server === "example") {
        // servers/example.yaml and .env.example are the templates, both tracked.
        throw new Error("example is the template. Copy servers/example.yaml to servers/<name>.yaml and launch that name.");
    }
    return { server, json };
}

function commandWorks(cmd: string, args: string[]): boolean {
    const r = spawnSync(cmd, args, { stdio: "ignore" });
    return r.status === 0;
}

/**
 * What a machine can check before anything is spent. The tailnet policy and
 * the kind of auth key cannot be read from here without a Tailscale API
 * credential the launchpad does not hold, so the skill asks the person about
 * them, and steps 2 and 3 prove them on the real node.
 */
function preflight(spec: ServerSpec): void {
    const problems: string[] = [];
    try {
        requireEnvFile(envPath(spec.name, repoRoot));
    } catch (err) {
        problems.push((err as Error).message);
    }
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 20) problems.push(`Node ${process.versions.node} is too old; the launchpad needs Node 20 or newer.`);
    if (!commandWorks("pulumi", ["version"])) problems.push("The pulumi command is not on the path. Install the Pulumi CLI.");
    if (!commandWorks("ssh", ["-V"])) problems.push("The ssh command is not on the path.");
    if (!commandWorks("tailscale", ["status"])) {
        problems.push("This computer is not on the tailnet: `tailscale status` failed. Sign in to Tailscale here first.");
    }
    if (problems.length > 0) throw new Error(problems.join("\n"));
}

async function launch(args: Args, onProgress: OnProgress): Promise<string> {
    const spec = await step(onProgress, `Reading servers/${args.server}.yaml`, () => loadSpec(args.server, repoRoot));
    await step(onProgress, `Checking this computer and .env.${spec.name}`, () => preflight(spec));

    const ctx: PulumiContext = { repoRoot, server: spec.name, secrets: secretsForChild(envPath(spec.name, repoRoot)) };

    await step(onProgress, "Preparing the local Pulumi stack", () => ensureStack(ctx), (r) => r);
    const publicIp = await step(
        onProgress,
        `Creating the server on Hetzner (${spec.hetzner.type}, ${spec.hetzner.location})`,
        () => {
            runPulumi(ctx, ["up", "--yes", "--skip-preview", "--stack", spec.name]);
            return stackOutput(ctx, "ipv4Address");
        },
        (ip) => `public IP ${ip}`,
    );
    const privateKey = stackOutput(ctx, "privateKey", true);

    return withStagedKey(privateKey, async (keyPath) => {
        const leg1: SshTarget = { host: publicIp, user: "root", keyPath };
        await step(
            onProgress,
            "Waiting for cloud-init to finish and Coolify to answer (up to 20 minutes)",
            () => waitForPhaseA(leg1),
            (r) => (r.localhostAnswers ? undefined : "localhost:8000 does not answer on the box; 127.0.0.1:8000 does"),
        );
        const tailnet = await step(
            onProgress,
            "Verifying the tailnet node",
            () => verifyTailnet(leg1, spec.name),
            (t) => `${t.dnsName}, ${t.tailnetIp}`,
        );
        await step(onProgress, "Proving the SSH grant from this computer", () => proveSshGrant(tailnet.tailnetIp));
        return renderGrantProved({
            server: spec.name,
            type: spec.hetzner.type,
            location: spec.hetzner.location,
            publicIp,
            tailnetIp: tailnet.tailnetIp,
            dnsName: tailnet.dnsName,
        });
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
        if (e.step.startsWith("Creating the server")) serverMayExist = true;
        render(e);
    };
    try {
        const summary = await launch(args, onProgress);
        if (args.json) process.stdout.write(JSON.stringify({ type: "result", status: "grant-proved", summary }) + "\n");
        else process.stdout.write(`\n${summary}\n`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stopped = {
            reached,
            finding: message.split("\n")[0],
            then: serverMayExist
                ? [
                    `npm run launch -- --server ${args.server}`,
                    "pulumi destroy, as tests/rehearsal.md describes, until /retire-server lands",
                ]
                : [`fix the finding, then npm run launch -- --server ${args.server}`],
        };
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
