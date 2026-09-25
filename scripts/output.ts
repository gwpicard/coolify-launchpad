import type { ProgressEvent } from "../lib/progress.js";

/**
 * What the launch prints. Progress arrives as numbered milestones for a person,
 * or as one JSON object per line with `--json` for a skill to read:
 *
 *   [ 1] Checking this computer and .env.alpha…
 *        ✓ Checking this computer and .env.alpha  2s
 *   [ 2] Creating the server on Hetzner…
 *
 * Steps are numbered as they arrive, because the count depends on how far a
 * launch gets.
 */
export function makeProgressRenderer(
    json: boolean,
    write: (s: string) => void = (s) => process.stdout.write(s),
): (e: ProgressEvent) => void {
    if (json) return (e) => write(JSON.stringify({ type: "progress", ...e }) + "\n");
    let counter = 0;
    return (e) => {
        if (e.status === "started") {
            counter += 1;
            write(`  [${String(counter).padStart(2, " ")}] ${e.step}…\n`);
            return;
        }
        const icon = e.status === "done" ? "✓" : e.status === "skipped" ? "↷" : "✗";
        const time = e.durationMs !== undefined ? `  ${humanDuration(e.durationMs)}` : "";
        const detail = e.detail ? `  (${e.detail})` : "";
        write(`       ${icon} ${e.step}${time}${detail}\n`);
    };
}

export function humanDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    return `${min}m ${totalSec - min * 60}s`;
}

export interface Stopped {
    /** The last step that passed, or "nothing yet". */
    reached: string;
    /** One line, quoting the log or probe. */
    finding: string;
    /** The ways forward, joined with " | ". */
    then: string[];
}

/** The failure block from docs/positioning.md. */
export function renderStopped(s: Stopped): string {
    return [
        "Not launched yet, coolify-launchpad",
        `Reached:   ${s.reached}`,
        `Finding:   ${s.finding}`,
        `Then:      ${s.then.join(" | ")}`,
    ].join("\n");
}

export interface GrantProved {
    server: string;
    type: string;
    location: string;
    publicIp: string;
    tailnetIp: string;
    dnsName: string;
}

/**
 * What a launch prints when it has proved the SSH grant, which is where it
 * stops until Phase B's later steps land. It is not the server block: the
 * firewall still has port 22 open, and there is no env file yet.
 */
export function renderGrantProved(g: GrantProved): string {
    return [
        "SSH grant proved, coolify-launchpad",
        `Server:    Hetzner ${g.type}, ${g.location}, Ubuntu 24.04, public IP ${g.publicIp}`,
        `Tailnet:   ${g.dnsName} (${g.tailnetIp}), tag:server, key expiry disabled, Tailscale SSH on`,
        `Coolify:   answering on the box at http://127.0.0.1:8000`,
        `Not yet:   port 22 is still open, and there is no admin account, env file or server block.`,
        `           Phase B's later steps arrive in the next version of the launchpad.`,
    ].join("\n");
}
