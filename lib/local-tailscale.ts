import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Tailscale on the operator's machine. The launch, the check and the retire
 * all need it: to be on the tailnet at all, and to find a server's tailnet
 * address after port 22 has closed.
 */

/**
 * The Mac App Store build puts no `tailscale` on the path; its command sits
 * inside the app instead.
 */
export const MAC_APP_TAILSCALE = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

export function commandWorks(cmd: string, args: string[]): boolean {
    const r = spawnSync(cmd, args, { stdio: "ignore", timeout: 30_000 });
    return r.status === 0;
}

export function tailscaleCommand(): string | undefined {
    if (commandWorks("tailscale", ["version"])) return "tailscale";
    if (process.platform === "darwin" && existsSync(MAC_APP_TAILSCALE)) return MAC_APP_TAILSCALE;
    return undefined;
}

/**
 * The server's tailnet IPv4 address, as this computer's Tailscale knows it,
 * or undefined when this computer has no peer of that name. It asks the local
 * Tailscale service only; nothing goes to the server.
 */
export function tailnetIpOf(name: string, command = tailscaleCommand()): string | undefined {
    if (!command) return undefined;
    const r = spawnSync(command, ["ip", "-4", name], { encoding: "utf8", timeout: 30_000 });
    if (r.status !== 0) return undefined;
    const ip = (r.stdout ?? "").trim().split("\n")[0];
    return /^100\.\d+\.\d+\.\d+$/.test(ip) ? ip : undefined;
}
