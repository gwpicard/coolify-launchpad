import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Runs the Pulumi CLI for one server's stack. The program lives in program/,
 * the state in .pulumi/ at the repository root, and the stack is named after
 * the server.
 *
 * The backend is set here through PULUMI_BACKEND_URL rather than left to
 * whatever `pulumi login` last chose, so a machine that is also signed in to
 * Pulumi Cloud for other work still keeps this state in the local folder.
 */
export interface PulumiContext {
    repoRoot: string;
    server: string;
    /** The secrets from .env.<name>, passed through to the child and nowhere else. */
    secrets: Record<string, string>;
}

export function programDir(repoRoot: string): string {
    return resolve(repoRoot, "program");
}

export function backendUrl(repoRoot: string): string {
    return `file://${resolve(repoRoot, ".pulumi")}`;
}

export function pulumiEnv(ctx: PulumiContext): NodeJS.ProcessEnv {
    return {
        ...process.env,
        ...ctx.secrets,
        SERVER: ctx.server,
        PULUMI_BACKEND_URL: backendUrl(ctx.repoRoot),
        PULUMI_SKIP_UPDATE_CHECK: "true",
    };
}

export interface PulumiResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

export function pulumiProbe(ctx: PulumiContext, args: string[]): PulumiResult {
    mkdirSync(resolve(ctx.repoRoot, ".pulumi"), { recursive: true });
    const r = spawnSync("pulumi", [...args, "--non-interactive"], {
        cwd: programDir(ctx.repoRoot),
        env: pulumiEnv(ctx),
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run pulumi and return stdout. On failure, throw with the last lines of its output. */
export function runPulumi(ctx: PulumiContext, args: string[]): string {
    const r = pulumiProbe(ctx, args);
    if (r.status !== 0) {
        const tail = (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-8).join("\n");
        throw new Error(`pulumi ${args[0]} failed (exit ${r.status}):\n${tail}`);
    }
    return r.stdout;
}

/** Select the server's stack, creating it with the passphrase provider if it is new. */
export function ensureStack(ctx: PulumiContext): "created" | "existing" {
    const list = pulumiProbe(ctx, ["stack", "ls", "--json"]);
    if (list.status === 0) {
        try {
            const stacks = JSON.parse(list.stdout) as Array<{ name?: string }>;
            if (stacks.some((s) => s.name === ctx.server || s.name?.endsWith(`/${ctx.server}`))) return "existing";
        } catch {
            // Fall through and try to create; a real problem will show there.
        }
    }
    runPulumi(ctx, ["stack", "init", ctx.server, "--secrets-provider", "passphrase"]);
    return "created";
}

/** One stack output as text. Secrets need `showSecrets`. */
export function stackOutput(ctx: PulumiContext, name: string, showSecrets = false): string {
    const args = ["stack", "output", name, "--stack", ctx.server];
    if (showSecrets) args.push("--show-secrets");
    return runPulumi(ctx, args).trim();
}
