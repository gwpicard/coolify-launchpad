import type { ProgressEvent } from "../lib/progress.js";

export { renderStopped, type Stopped } from "../lib/server-block.js";

/**
 * What the launch, the check and the retire print. Progress arrives as
 * numbered milestones for a person, or as one JSON object per line with
 * `--json` for a skill to read:
 *
 *   [ 1] Checking this computer and .env.alpha…
 *        ✓ Checking this computer and .env.alpha  2s
 *   [ 2] Creating the server on Hetzner…
 *
 * Steps are numbered as they arrive, because the count depends on how far a
 * launch gets. A step that waits for the person prints what they must do,
 * under its number, with an arrow.
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
            if (e.ask) write(`       → ${e.ask}\n`);
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
