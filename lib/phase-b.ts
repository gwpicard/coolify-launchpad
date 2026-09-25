import { pollUntil, sshProbe, sshRun, type SshTarget } from "./ssh.js";
import { checkTailnet, type TailnetFacts } from "./tailnet.js";

/**
 * Phase B, steps 1 to 3, from docs/design.md. Steps 1 and 2 use leg one
 * (root@<public-ip> with the Pulumi key). Step 3 proves leg two (root over
 * Tailscale SSH, no key) from this computer, and every later step uses it.
 */

export const PHASE_A_TIMEOUT_MS = 20 * 60_000;

/**
 * One round trip that reports cloud-init's state, the sentinel, and whether
 * Coolify answers on 127.0.0.1:8000. Each line is key=value so the parse
 * below does not depend on the order or on anything else the box prints.
 */
export const PHASE_A_PROBE = [
    `echo "cloud-init=$(cloud-init status 2>/dev/null | sed -n 's/^status: //p')"`,
    `if [ -f /var/lib/coolify-launchpad/phase-a-done ]; then echo sentinel=yes; else echo sentinel=no; fi`,
    `if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:8000; then echo coolify=yes; else echo coolify=no; fi`,
].join("; ");

export interface PhaseAState {
    cloudInit: string;
    sentinel: boolean;
    coolify: boolean;
}

export function readPhaseA(stdout: string): PhaseAState {
    const kv = new Map<string, string>();
    for (const line of stdout.split(/\r?\n/)) {
        const eq = line.indexOf("=");
        if (eq > 0) kv.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }
    return {
        cloudInit: kv.get("cloud-init") ?? "",
        sentinel: kv.get("sentinel") === "yes",
        coolify: kv.get("coolify") === "yes",
    };
}

/** Decide one poll of step 1: done, keep waiting, or stop now. */
export function judgePhaseA(s: PhaseAState): { done: true; value: PhaseAState } | { done: false; last: string } | { fail: string } {
    if (s.cloudInit === "error") {
        return {
            fail:
                "cloud-init reported an error, so Phase A stopped partway. " +
                "Read /var/log/cloud-init-output.log on the server to see which step failed.",
        };
    }
    if (s.sentinel && s.coolify) return { done: true, value: s };
    return {
        done: false,
        last: `cloud-init ${s.cloudInit || "not answering"}, sentinel ${s.sentinel ? "present" : "absent"}, Coolify ${s.coolify ? "answering" : "not answering"}`,
    };
}

export interface CoolifyReady {
    /** Whether `localhost:8000` answers too; false means it resolved to IPv6 on this box. */
    localhostAnswers: boolean;
}

/** Step 1: wait for the sentinel and for Coolify, with a 20-minute limit. */
export async function waitForPhaseA(leg1: SshTarget, timeoutMs = PHASE_A_TIMEOUT_MS): Promise<CoolifyReady> {
    await pollUntil(
        () => {
            const r = sshProbe(leg1, PHASE_A_PROBE);
            if (!r.ok) return { done: false, last: r.stderr.trim().split("\n").pop() || "SSH not answering yet" };
            return judgePhaseA(readPhaseA(r.stdout));
        },
        { timeoutMs, intervalMs: 15_000, what: "Phase A finishing and Coolify answering on port 8000" },
    );
    // localhost:8000 is what coolify-devops's env file points at. On a Hetzner
    // box localhost once resolved to IPv6 while a service bound IPv4 only, so
    // check it here rather than after the hand-over.
    const local = sshProbe(leg1, "curl -sI --max-time 5 http://localhost:8000 >/dev/null");
    return { localhostAnswers: local.ok };
}

export interface TailnetOnBox extends TailnetFacts {
    tailnetIp: string;
    /** The address the box sees itself leave from, over IPv4. */
    publicIpSeen: string;
}

/** Step 2: verify the node with coolify-devops's own checks. */
export function verifyTailnet(leg1: SshTarget, serverName: string): TailnetOnBox {
    const status = sshRun(leg1, "tailscale status --json");
    const prefs = sshRun(leg1, "tailscale debug prefs");
    const check = checkTailnet(status, prefs, serverName);
    if (!check.facts) throw new Error(check.problems.join("\n"));
    const tailnetIp = sshRun(leg1, "tailscale ip -4").trim().split("\n")[0];
    if (!/^100\.\d+\.\d+\.\d+$/.test(tailnetIp)) {
        throw new Error(`tailscale ip -4 gave "${tailnetIp}", which is not a tailnet address`);
    }
    const publicIpSeen = sshProbe(leg1, "curl -4 -s --max-time 10 https://api.ipify.org").stdout.trim();
    return { ...check.facts, tailnetIp, publicIpSeen };
}

/**
 * Step 3: from this computer, `ssh -o BatchMode=yes root@<tailnet-ip> true`
 * with every key method off. It retries for a short while because a new node
 * can take a moment to reach this computer's peer list.
 */
export async function proveSshGrant(tailnetIp: string, timeoutMs = 90_000): Promise<SshTarget> {
    const leg2: SshTarget = { host: tailnetIp, user: "root" };
    try {
        await pollUntil(
            () => {
                const r = sshProbe(leg2, "true");
                return r.ok ? { done: true, value: true } : { done: false, last: r.stderr.trim().split("\n").pop() || `exit ${r.status}` };
            },
            { timeoutMs, intervalMs: 10_000, what: `Tailscale SSH to root@${tailnetIp} from this computer` },
        );
    } catch (err) {
        const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
        throw new Error(
            `${why}. The tailnet policy needs an ssh rule whose destination is tag:server and whose users are root, ` +
            `with your group as the source (docs/server-model.md, Two SSH legs). Nothing has closed yet; ` +
            `paste the rule and run the launch again.`,
        );
    }
    return leg2;
}
