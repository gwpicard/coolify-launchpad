#!/usr/bin/env tsx
/**
 * `npm run check-server -- --server <name> [--json]`
 *
 * Reads a launched server back without changing it: the live firewall rules
 * through the Hetzner API, the outside probe from this computer, the node over
 * the tailnet, Coolify answering there, the env file (its presence, mode and
 * whether the token is set, never a value), and the tools on the box. It
 * prints one table with the broken things first, then the server block again.
 *
 * It exits 1 when anything is broken, so a script can tell.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { envPath, loadSpec } from "../lib/spec.js";
import { SECRETS_AFTER_LAUNCH, secretsForChild } from "../lib/env.js";
import { stackOutput, type PulumiContext } from "../lib/pulumi.js";
import { remote } from "../lib/ssh.js";
import { fetchGithubHooks, HetznerApi, httpStatus, probePort } from "../lib/hetzner-firewall.js";
import { blockPath } from "../lib/server-block.js";
import { tailnetIpOf } from "../lib/local-tailscale.js";
import { checkServer, renderCheck } from "../lib/check.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const USAGE = "Usage: npm run check-server -- --server <name> [--json]";

function parseArgs(argv: string[]): { server: string; json: boolean } {
    let server: string | undefined;
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--server") server = argv[++i];
        else if (a === "--json") json = true;
        else throw new Error(`Unknown argument "${a}". ${USAGE}`);
    }
    if (!server) throw new Error(`Missing --server <name>. ${USAGE}`);
    return { server, json };
}

async function main(): Promise<void> {
    let args: { server: string; json: boolean };
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error((err as Error).message);
        process.exit(2);
    }
    try {
        const spec = loadSpec(args.server, repoRoot);
        const secrets = secretsForChild(envPath(spec.name, repoRoot), SECRETS_AFTER_LAUNCH);
        const ctx: PulumiContext = { repoRoot, server: spec.name, secrets };
        const report = await checkServer(spec, {
            stack: () => ({ publicIp: stackOutput(ctx, "ipv4Address"), serverId: Number(stackOutput(ctx, "serverId")) }),
            tailnetIpOf: (name) => tailnetIpOf(name),
            remote,
            hetzner: new HetznerApi(secrets.HCLOUD_TOKEN),
            fetchGithubHooks: () => fetchGithubHooks(),
            probePort: (host, port) => probePort(host, port),
            httpStatus: (url) => httpStatus(url),
            readBlock: (name) => {
                const path = blockPath(name, repoRoot);
                return existsSync(path) ? readFileSync(path, "utf8").trimEnd() : undefined;
            },
        });
        if (args.json) process.stdout.write(JSON.stringify({ type: "result", status: report.broken ? "broken" : "ok", ...report }) + "\n");
        else process.stdout.write(`${renderCheck(spec.name, report)}\n`);
        process.exit(report.broken > 0 ? 1 : 0);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (args.json) process.stdout.write(JSON.stringify({ type: "result", status: "stopped", detail: message }) + "\n");
        else process.stdout.write(`The check could not start: ${message}\n`);
        process.exit(1);
    }
}

void main();
