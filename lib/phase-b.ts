import { parseKeyValues, pollUntil, shellSingleQuote, sshProbe, sshRun, type Remote, type SshTarget } from "./ssh.js";
import { checkTailnet, type TailnetFacts } from "./tailnet.js";

/**
 * Phase B, steps 1 to 6, from docs/design.md. Steps 1 and 2 use leg one
 * (root@<public-ip> with the Pulumi key), or leg two on a `--resume`. Step 3
 * proves leg two (root over Tailscale SSH, no key) from this computer, and
 * steps 4 to 6 use it. Steps 7 and 8, the firewall and the probe, are in
 * hetzner-firewall.ts, and step 9, the block, is in server-block.ts.
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
            const r = sshProbe(leg1, PHASE_A_PROBE, 60_000);
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
export const GRANT_ATTEMPT_TIMEOUT_MS = 30_000;

export const CHECK_RULE_FINDING =
    "Tailscale SSH held the connection open, which is what an ssh rule with action \"check\" does while it waits " +
    "for someone to sign in in a browser. Nothing can sign in during a launch. In the tailnet policy, change the " +
    "ssh rule whose destination is tag:server to action \"accept\", then run the launch again. Nothing has closed yet.";

export async function proveSshGrant(
    tailnetIp: string,
    timeoutMs = 90_000,
    attemptTimeoutMs = GRANT_ATTEMPT_TIMEOUT_MS,
): Promise<SshTarget> {
    const leg2: SshTarget = { host: tailnetIp, user: "root" };
    try {
        await pollUntil(
            () => {
                const r = sshProbe(leg2, "true", attemptTimeoutMs);
                if (r.timedOut) return { fail: CHECK_RULE_FINDING };
                return r.ok ? { done: true, value: true } : { done: false, last: r.stderr.trim().split("\n").pop() || `exit ${r.status}` };
            },
            { timeoutMs, intervalMs: 10_000, what: `Tailscale SSH to root@${tailnetIp} from this computer` },
        );
    } catch (err) {
        if (err instanceof Error && err.message === CHECK_RULE_FINDING) throw err;
        const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
        throw new Error(
            `${why}. The tailnet policy needs an ssh rule whose destination is tag:server and whose users are root, ` +
            `with your group as the source (docs/server-model.md, Two SSH legs). Nothing has closed yet; ` +
            `paste the rule and run the launch again.`,
        );
    }
    return leg2;
}

// After step 2: the tailnet machine must be this Hetzner server.

/**
 * A machine is found on the tailnet by name, and a stale machine of the same
 * name can still be there. So the node is asked who it is: its Hetzner
 * instance id from the metadata service, and the public address it leaves
 * from. Both are compared with the stack.
 */
export const NODE_IDENTITY_PROBE = [
    `echo "instance_id=$(curl -s --max-time 5 http://169.254.169.254/hetzner/v1/metadata/instance-id 2>/dev/null)"`,
    `echo "public_ip=$(curl -4 -s --max-time 10 https://api.ipify.org 2>/dev/null)"`,
].join("\n");

export interface NodeIdentity {
    instanceId: string;
    publicIp: string;
}

export function readNodeIdentity(stdout: string): NodeIdentity {
    const kv = parseKeyValues(stdout);
    return { instanceId: kv.get("instance_id") ?? "", publicIp: kv.get("public_ip") ?? "" };
}

export interface ExpectedNode {
    name: string;
    publicIp: string;
    serverId: number;
}

/**
 * The public address must equal the stack's. The instance id must too, when
 * the metadata service gave one; it is the stronger proof, since Hetzner
 * recycles addresses.
 */
export function identityProblems(id: NodeIdentity, expected: ExpectedNode): string[] {
    const problems: string[] = [];
    const other =
        `It is another machine, probably an older one named ${expected.name} that is still on the tailnet. ` +
        "Remove it in the Tailscale console under Machines, then try again.";
    if (!id.publicIp) {
        problems.push(
            `The tailnet machine named ${expected.name} did not say which public address it leaves from, ` +
            "so it cannot be shown to be this server.",
        );
    } else if (id.publicIp !== expected.publicIp) {
        problems.push(
            `The tailnet machine named ${expected.name} leaves from ${id.publicIp}, but this server's public IP is ` +
            `${expected.publicIp}. ${other}`,
        );
    }
    if (/^\d+$/.test(id.instanceId) && Number(id.instanceId) !== expected.serverId) {
        problems.push(
            `The tailnet machine named ${expected.name} is Hetzner server ${id.instanceId}, but the stack holds ` +
            `${expected.serverId}. ${other}`,
        );
    }
    return problems;
}

/** Ask the node who it is, and throw unless it is the expected server. */
export function checkNodeIdentity(box: Remote, expected: ExpectedNode): NodeIdentity {
    const id = readNodeIdentity(box.probe(NODE_IDENTITY_PROBE, 60_000).stdout);
    const problems = identityProblems(id, expected);
    if (problems.length > 0) throw new Error(problems.join(" "));
    return id;
}

// Step 4: the admin account.

/** Asked without -L: Coolify answers 200 while registration is open, and redirects once it closes. */
export const REGISTER_PROBE =
    "curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8000/register";

export const ADMIN_WAIT_MS = 20 * 60_000;

/** Ask `/register` once, and give its status code, or "" when nothing answered. */
export function registerStatus(box: Remote): { code: string; stderr: string } {
    const r = box.probe(REGISTER_PROBE, 30_000);
    return { code: r.stdout.trim(), stderr: r.stderr.trim() };
}

/**
 * Whether the admin account exists. Any real status other than 200 means
 * Coolify closed registration. A status of 000, or no answer, means curl got
 * nothing, which is a reason to keep waiting, not to decide.
 */
export function registrationClosed(code: string): boolean {
    return /^[1-9]\d\d$/.test(code) && code !== "200";
}

/** What the person is asked to do while step 4 waits. */
export function adminInstruction(tailnetIp: string): string {
    return (
        `Open http://${tailnetIp}:8000 from this computer now and create the Coolify admin account. ` +
        `Whoever reaches that page first owns the server, which is why nothing is open to the internet yet. ` +
        `Then turn on two-factor authentication. It should be under Settings, General, but no real launch has confirmed that place yet.`
    );
}

export function adminNotSeenFinding(server: string): string {
    return (
        "Coolify's /register page still answers 200, so the launch cannot tell that the admin account exists. " +
        `If you have created it, run: npm run launch -- --server ${server} --resume --admin-created`
    );
}

/** Wait until `/register` stops answering 200, as `registrationClosed` reads it. */
export async function waitForAdmin(
    box: Remote,
    server: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
    try {
        return await pollUntil(
            () => {
                const { code, stderr } = registerStatus(box);
                if (registrationClosed(code)) return { done: true, value: code };
                return {
                    done: false,
                    last: code === "200" ? "registration still open" : `no answer (${code || stderr || "nothing"})`,
                };
            },
            { timeoutMs: opts.timeoutMs ?? ADMIN_WAIT_MS, intervalMs: opts.intervalMs ?? 5_000, what: "The admin account" },
        );
    } catch {
        throw new Error(adminNotSeenFinding(server));
    }
}

// Step 5: the env file.

export const ENV_FILE_NAME = "coolify-devops.env";

/**
 * The script that writes the env file once. It never touches a file that
 * exists, so a `--resume`, or a file the person has already filled, is left
 * exactly as it was. The token line is a comment: the person adds the token on
 * the server with the command /setup-coolify-devops prints. The launchpad's
 * own HCLOUD_TOKEN is never in it.
 *
 * `home` is /root on the server. The unit tests run the same script against a
 * folder of their own.
 */
export function envFileScript(coolifyUrl: string, home = "/root"): string {
    if (!/^http:\/\/(localhost|127\.0\.0\.1):8000$/.test(coolifyUrl)) {
        throw new Error(`"${coolifyUrl}" is not a URL the env file takes`);
    }
    const dir = `${home}/.config`;
    const file = `${dir}/${ENV_FILE_NAME}`;
    const bashrc = shellSingleQuote(`${home}/.bashrc`);
    const body = [
        "# Written once by coolify-launchpad, which never overwrites it. Read by coolify-devops's MCP.",
        `export COOLIFY_BASE_URL=${coolifyUrl}`,
        "# export COOLIFY_ACCESS_TOKEN=<token>   # read, write and deploy scopes; never root. Added by you, on the server.",
    ].join("\n");
    return [
        "set -eu",
        `f=${shellSingleQuote(file)}`,
        `if [ -e "$f" ]; then echo env=kept; else`,
        `  ( umask 077; mkdir -p ${shellSingleQuote(dir)}; printf '%s\\n' ${shellSingleQuote(body)} > "$f" )`,
        "  echo env=written",
        "fi",
        `grep -q ${ENV_FILE_NAME} ${bashrc} 2>/dev/null || echo '. ~/.config/${ENV_FILE_NAME}' >> ${bashrc}`,
        `echo "mode=$(stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f")"`,
    ].join("\n");
}

export interface EnvFileResult {
    written: boolean;
    mode: string;
}

export function writeEnvFile(box: Remote, coolifyUrl: string): EnvFileResult {
    const kv = parseKeyValues(box.run(envFileScript(coolifyUrl)));
    const state = kv.get("env");
    if (state !== "written" && state !== "kept") throw new Error("The env file step gave no answer");
    return { written: state === "written", mode: kv.get("mode") ?? "unknown" };
}

// Step 6: the coolify-devops skills, and a /root the scaffolder will accept.

/** What coolify-devops's scaffolder refuses to find in the folder it scaffolds. */
export const ROOT_MUST_NOT_HOLD = ["AGENTS.md", "CLAUDE.md", "instance.yaml", "docs", "stacks"] as const;

export const SKILLS_LOG = "/var/log/coolify-launchpad-skills.log";

/**
 * The first -y is for npx itself, since there is no terminal to answer it.
 * The install is skipped when skills-lock.json shows it already happened.
 */
export const SKILLS_INSTALL = [
    "cd /root",
    "if [ -f /root/skills-lock.json ]; then echo skills=kept; exit 0; fi",
    `if NODE_OPTIONS=--dns-result-order=ipv4first npx -y skills add KasperHonore/coolify-devops -a claude-code -y </dev/null >${SKILLS_LOG} 2>&1; then`,
    "  echo skills=installed",
    "else",
    `  echo skills=failed; tail -n 5 ${SKILLS_LOG} | sed 's/^/log=/'; exit 1`,
    "fi",
].join("\n");

export const SKILLS_TIMEOUT_MS = 10 * 60_000;

export function installSkills(box: Remote): "installed" | "kept" {
    const r = box.probe(SKILLS_INSTALL, SKILLS_TIMEOUT_MS);
    const state = parseKeyValues(r.stdout).get("skills");
    if (r.ok && (state === "installed" || state === "kept")) return state;
    if (r.timedOut) throw new Error(`The coolify-devops skills install did not finish within ${SKILLS_TIMEOUT_MS / 60_000} minutes`);
    const log = r.stdout.split("\n").filter((l) => l.startsWith("log=")).map((l) => l.slice(4)).pop();
    throw new Error(
        `The coolify-devops skills install failed: ${log ?? (r.stderr.trim() || `exit ${r.status}`)}. ` +
        `The full log is ${SKILLS_LOG} on the server.`,
    );
}

/**
 * Everything the later steps, the block and the check read off the box, in
 * one round trip. The token is checked the way AGENTS.md says a secret is
 * checked: the file is sourced in a subshell and only "set" or "unset" comes
 * back. Nothing prints a value.
 */
export const BOX_FACTS_PROBE = [
    `f=/root/.config/${ENV_FILE_NAME}`,
    `if [ -f "$f" ]; then echo env=yes; echo "env_mode=$(stat -c %a "$f")"; else echo env=no; fi`,
    `if grep -q ${ENV_FILE_NAME} /root/.bashrc 2>/dev/null; then echo bashrc=yes; else echo bashrc=no; fi`,
    `( . "$f" >/dev/null 2>&1; if [ -n "\${COOLIFY_ACCESS_TOKEN:-}" ]; then echo token=set; else echo token=unset; fi )`,
    `echo "node=$(node --version 2>/dev/null)"`,
    `for t in git jq claude; do if command -v "$t" >/dev/null 2>&1; then echo "$t=yes"; else echo "$t=no"; fi; done`,
    `if [ -f /root/skills-lock.json ]; then echo skills=yes; else echo skills=no; fi`,
    `for p in ${ROOT_MUST_NOT_HOLD.join(" ")}; do if [ -e "/root/$p" ]; then echo "clutter=$p"; fi; done`,
    `if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:8000; then echo coolify=yes; else echo coolify=no; fi`,
    `if curl -sI -o /dev/null --max-time 5 http://localhost:8000; then echo localhost=yes; else echo localhost=no; fi`,
].join("\n");

export interface BoxFacts {
    envFile: boolean;
    envMode: string;
    bashrcSources: boolean;
    tokenSet: boolean;
    nodeVersion: string;
    git: boolean;
    jq: boolean;
    claude: boolean;
    skillsLock: boolean;
    /** Which of ROOT_MUST_NOT_HOLD are present in /root. */
    clutter: string[];
    coolifyAnswers: boolean;
    localhostAnswers: boolean;
}

export function readBoxFacts(stdout: string): BoxFacts {
    const kv = parseKeyValues(stdout);
    const yes = (k: string) => kv.get(k) === "yes";
    const clutter = stdout
        .split(/\r?\n/)
        .filter((l) => l.startsWith("clutter="))
        .map((l) => l.slice("clutter=".length).trim());
    return {
        envFile: yes("env"),
        envMode: kv.get("env_mode") ?? "",
        bashrcSources: yes("bashrc"),
        tokenSet: kv.get("token") === "set",
        nodeVersion: kv.get("node") ?? "",
        git: yes("git"),
        jq: yes("jq"),
        claude: yes("claude"),
        skillsLock: yes("skills"),
        clutter,
        coolifyAnswers: yes("coolify"),
        localhostAnswers: yes("localhost"),
    };
}

export function readBox(box: Remote): BoxFacts {
    return readBoxFacts(box.run(BOX_FACTS_PROBE, 60_000));
}

/** Node's major version from `node --version`, or 0 when there is none. */
export function nodeMajor(version: string): number {
    const m = /^v?(\d+)\./.exec(version.trim());
    return m ? Number(m[1]) : 0;
}

/**
 * What step 6 requires of the box before the hand-over: /root free of what
 * the scaffolder refuses, git and jq, and, when the tooling was asked for,
 * Node 18 or newer, Claude Code and the skills.
 */
export function toolingProblems(facts: BoxFacts, installTooling: boolean): string[] {
    const problems: string[] = [];
    if (facts.clutter.length > 0) {
        problems.push(
            `/root holds ${facts.clutter.join(", ")}, and coolify-devops's scaffolder refuses to run while it does. ` +
            "Move them out of /root, then resume.",
        );
    }
    if (!facts.git || !facts.jq) problems.push("git or jq is missing on the box, so cloud-init's first section did not finish as written.");
    if (installTooling) {
        if (nodeMajor(facts.nodeVersion) < 18) {
            problems.push(
                `Node on the box is "${facts.nodeVersion || "absent"}"; coolify-devops needs 18 or newer. ` +
                "Read /var/log/cloud-init-output.log on the server.",
            );
        }
        if (!facts.claude) problems.push("Claude Code is not on the box. Read /var/log/cloud-init-output.log on the server.");
        if (!facts.skillsLock) problems.push("The coolify-devops skills are not in /root: there is no /root/skills-lock.json.");
    }
    return problems;
}
