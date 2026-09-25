import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

/**
 * The SSH harness, taken from hermes-launchpad. The launchpad reaches a new
 * server in two legs, described in docs/server-model.md:
 *
 *   1. root@<public-ip> with the key Pulumi generated, over port 22.
 *   2. root@<tailnet-ip> over Tailscale SSH, with no key at all.
 *
 * A target with a `keyPath` is leg one. A target without one is leg two, and
 * its arguments switch off every key and password method, so a connection
 * that succeeds proves the tailnet's SSH grant rather than a key that happened
 * to be in this computer's agent.
 */
export interface SshTarget {
    host: string;
    user: string;
    /** Leg one only: the staged private key. Absent means Tailscale SSH. */
    keyPath?: string;
}

export interface ProbeResult {
    ok: boolean;
    status: number | null;
    stdout: string;
    stderr: string;
}

/**
 * Quote a string for safe use inside a single-quoted shell context.
 */
export function shellSingleQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sshArgs(target: SshTarget, extra: string[]): string[] {
    const auth = target.keyPath
        ? ["-i", target.keyPath, "-o", "IdentitiesOnly=yes"]
        : [
            "-o", "PubkeyAuthentication=no",
            "-o", "PasswordAuthentication=no",
            "-o", "KbdInteractiveAuthentication=no",
        ];
    return [
        ...auth,
        // Hetzner recycles IP addresses and a replaced machine gets a new host
        // key. `accept-new` refused a replaced machine on a remembered address,
        // so nothing is remembered. The address came from our own Pulumi stack
        // or our own tailnet, so we already know it is our machine.
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=30",
        ...extra,
    ];
}

function destination(target: SshTarget): string {
    return `${target.user}@${target.host}`;
}

/** Run a command over SSH without throwing. For probes and polls. */
export function sshProbe(target: SshTarget, command: string): ProbeResult {
    const r = spawnSync("ssh", sshArgs(target, [destination(target), command]), {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
    });
    return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run a command over SSH. Returns stdout, throws on a non-zero exit. */
export function sshRun(target: SshTarget, command: string): string {
    const r = sshProbe(target, command);
    if (!r.ok) {
        const why = r.stderr.trim() || r.stdout.trim() || command.slice(0, 80);
        throw new Error(`ssh ${destination(target)} exited ${r.status}: ${why}`);
    }
    return r.stdout;
}

/** Copy a file with scp, using the same options as `sshRun`. */
export function scp(target: SshTarget, src: string, dst: string): void {
    const r = spawnSync("scp", sshArgs(target, [src, dst]), { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    if (r.status !== 0) {
        throw new Error(`scp ${src} to ${dst} exited ${r.status}: ${(r.stderr ?? "").trim()}`);
    }
}

export async function sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
}

export interface PollOptions {
    timeoutMs: number;
    intervalMs: number;
    /** What is being waited for, for the error message. */
    what: string;
}

/**
 * Call `attempt` until it returns `{ done: true }` or the deadline passes. An
 * attempt may also return `{ fail }` to stop early, for example when
 * cloud-init has already reported an error and waiting longer is pointless.
 */
export async function pollUntil<T>(
    attempt: () => { done: true; value: T } | { done: false; last: string } | { fail: string },
    opts: PollOptions,
): Promise<T> {
    const deadline = Date.now() + opts.timeoutMs;
    let last = "";
    for (;;) {
        const r = attempt();
        if ("fail" in r) throw new Error(r.fail);
        if (r.done) return r.value;
        last = r.last;
        if (Date.now() + opts.intervalMs > deadline) break;
        await sleep(opts.intervalMs);
    }
    const minutes = Math.round(opts.timeoutMs / 60_000);
    throw new Error(`${opts.what} did not happen within ${minutes} minutes. Last check: ${last || "no answer"}`);
}

/**
 * Stage a private key as a mode 600 file in a fresh temporary folder, and
 * return a cleanup that removes the folder. The caller runs cleanup in a
 * `finally`, so the key never outlives the step that needed it.
 */
export function stageSshKey(privateKey: string): { keyPath: string; cleanup: () => void } {
    const staging = mkdtempSync(resolve(tmpdir(), "coolify-launchpad-sshkey-"));
    const keyPath = resolve(staging, "id_ed25519");
    try {
        writeFileSync(keyPath, privateKey.trim() + "\n", { mode: 0o600 });
        chmodSync(keyPath, 0o600);
    } catch (err) {
        rmSync(staging, { recursive: true, force: true });
        throw err;
    }
    return { keyPath, cleanup: () => rmSync(staging, { recursive: true, force: true }) };
}

/** Run `fn` with a staged key and remove the key afterwards, whatever happens. */
export async function withStagedKey<T>(privateKey: string, fn: (keyPath: string) => Promise<T>): Promise<T> {
    const staged = stageSshKey(privateKey);
    try {
        return await fn(staged.keyPath);
    } finally {
        staged.cleanup();
    }
}
