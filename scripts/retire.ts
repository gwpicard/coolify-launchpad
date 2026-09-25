#!/usr/bin/env tsx
/**
 * `npm run retire -- --server <name> [--confirm <typed name>] [--json]`
 *
 * Destroys a server the launchpad made. First it checks that the local Pulumi
 * stack and the live Hetzner server and firewall are the launchpad's, and
 * refuses anything else. Then it shows what will be lost and waits for the
 * server name to be typed: at a prompt in a terminal, or through `--confirm`,
 * which is how /retire-server passes on what the person typed. Without either
 * it destroys nothing. Then it logs the node out of the tailnet over Tailscale
 * SSH, runs `pulumi destroy` and removes the stack, and hands over the console
 * step that removes the machine from the tailnet.
 */
import { existsSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { envPath, loadSpec, specPath } from "../lib/spec.js";
import { secretsForChild } from "../lib/env.js";
import { runPulumi, stackExists, type PulumiContext } from "../lib/pulumi.js";
import { remote } from "../lib/ssh.js";
import { HetznerApi } from "../lib/hetzner-firewall.js";
import { blockPath } from "../lib/server-block.js";
import { tailnetIpOf } from "../lib/local-tailscale.js";
import { renderRetired, retireServer } from "../lib/retire.js";
import type { ProgressEvent } from "../lib/progress.js";
import { makeProgressRenderer } from "./output.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const USAGE = "Usage: npm run retire -- --server <name> [--confirm <typed name>] [--json]";

interface Args {
    server: string;
    confirm?: string;
    json: boolean;
}

function parseArgs(argv: string[]): Args {
    let server: string | undefined;
    let confirm: string | undefined;
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--server") server = argv[++i];
        else if (a === "--confirm") confirm = argv[++i] ?? "";
        else if (a === "--json") json = true;
        else throw new Error(`Unknown argument "${a}". ${USAGE}`);
    }
    if (!server) throw new Error(`Missing --server <name>. ${USAGE}`);
    if (server === "example") throw new Error("example is the template, not a server.");
    return { server, confirm, json };
}

async function askTyped(args: Args, warning: string): Promise<string> {
    if (args.confirm !== undefined) return args.confirm;
    if (!process.stdin.isTTY || args.json) {
        throw new Error(
            `${warning} Nothing was destroyed. To go ahead, type the name: ` +
            `npm run retire -- --server ${args.server} --confirm <the name>`,
        );
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return await rl.question("Server name: ");
    } finally {
        rl.close();
    }
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
    const onProgress = (e: ProgressEvent) => render(e);
    try {
        const spec = loadSpec(args.server, repoRoot);
        const env = envPath(spec.name, repoRoot);
        const secrets = secretsForChild(env);
        const ctx: PulumiContext = { repoRoot, server: spec.name, secrets };
        const result = await retireServer(spec.name, {
            stackExists: () => stackExists(ctx),
            stackExport: () => JSON.parse(runPulumi(ctx, ["stack", "export", "--stack", spec.name])),
            hetzner: new HetznerApi(secrets.HCLOUD_TOKEN),
            tailnetIpOf: (name) => tailnetIpOf(name),
            remote,
            confirm: (warning) => askTyped(args, warning),
            destroy: () => void runPulumi(ctx, ["destroy", "--yes", "--skip-preview", "--stack", spec.name]),
            removeStack: () => void runPulumi(ctx, ["stack", "rm", spec.name, "--yes"]),
            removeRecords: () => {
                const removed: string[] = [];
                for (const p of [blockPath(spec.name, repoRoot), specPath(spec.name, repoRoot)]) {
                    if (existsSync(p)) {
                        rmSync(p);
                        removed.push(`servers/${basename(p)}`);
                    }
                }
                return removed;
            },
        }, onProgress);
        const text = renderRetired(spec.name, result, basename(env));
        if (args.json) process.stdout.write(JSON.stringify({ type: "result", status: "retired", text, ...result }) + "\n");
        else process.stdout.write(`\n${text}\n`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (args.json) process.stdout.write(JSON.stringify({ type: "result", status: "stopped", detail: message }) + "\n");
        else process.stdout.write(`\n${message}\n`);
        process.exit(1);
    }
}

void main();
