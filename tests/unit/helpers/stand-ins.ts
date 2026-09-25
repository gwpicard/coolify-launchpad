// Stand-ins for everything outside this computer: the Hetzner API, GitHub's
// meta endpoint, and a shell on the server. None of them opens a connection.
// The Hetzner stand-in answers only the calls the launchpad makes, and a call
// it does not know gets a 404, so an invented endpoint fails a test.
import { readFileSync } from "node:fs";
import { HetznerApi, type Fetch, type HetznerFirewall, type HetznerServer, type HetznerRuleOut } from "../../../lib/hetzner-firewall.js";
import type { ProbeResult as SshProbeResult, Remote } from "../../../lib/ssh.js";

/** A made-up token. The tests check it never shows up in a message. */
export const MARKER_TOKEN = "marker-hcloud-token-not-a-credential-000000000000000000000000000";

export const GITHUB_META = JSON.parse(
    readFileSync(new URL("../../fixtures/github-meta.json", import.meta.url), "utf8"),
) as { hooks: string[] };

export interface HetznerCall {
    method: string;
    path: string;
    body?: unknown;
    auth?: string;
}

export interface FakeHetznerState {
    firewalls: HetznerFirewall[];
    servers: HetznerServer[];
    /** How many times the set_rules action reads "running" before "success". */
    runningPolls?: number;
    /** Make the set_rules action end in an error. */
    actionError?: string;
    /** Rules the read-back returns instead of what was sent, to test the comparison. */
    readBackRules?: HetznerRuleOut[];
}

export function fakeHetzner(state: FakeHetznerState): { api: HetznerApi; calls: HetznerCall[]; fetchImpl: Fetch } {
    const calls: HetznerCall[] = [];
    let polls = 0;
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const fetchImpl: Fetch = async (input, init) => {
        const url = new URL(String(input));
        const path = url.pathname.replace(/^\/v1/, "");
        const method = init?.method ?? "GET";
        const headers = new Headers(init?.headers);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path: path + url.search, body, auth: headers.get("Authorization") ?? undefined });
        if (headers.get("Authorization") !== `Bearer ${MARKER_TOKEN}`) {
            return json({ error: { code: "unauthorized", message: "unable to authenticate" } }, 401);
        }
        const name = url.searchParams.get("name");
        let m: RegExpMatchArray | null;
        if (method === "GET" && path === "/firewalls") return json({ firewalls: state.firewalls.filter((f) => !name || f.name === name) });
        if (method === "GET" && path === "/servers") return json({ servers: state.servers.filter((s) => !name || s.name === name) });
        if (method === "GET" && (m = path.match(/^\/firewalls\/(\d+)$/))) {
            const fw = state.firewalls.find((f) => f.id === Number(m![1]));
            return fw ? json({ firewall: fw }) : json({ error: { code: "not_found", message: "firewall not found" } }, 404);
        }
        if (method === "POST" && (m = path.match(/^\/firewalls\/(\d+)\/actions\/set_rules$/))) {
            const fw = state.firewalls.find((f) => f.id === Number(m![1]));
            if (!fw) return json({ error: { code: "not_found", message: "firewall not found" } }, 404);
            fw.rules = state.readBackRules ?? (body as { rules: HetznerRuleOut[] }).rules.map((r) => ({ ...r, destination_ips: [] }));
            return json({ actions: [{ id: 77, status: "running", error: null }] }, 201);
        }
        if (method === "GET" && path === "/firewalls/actions/77") {
            polls += 1;
            if (polls <= (state.runningPolls ?? 1)) return json({ action: { id: 77, status: "running", error: null } });
            return json({
                action: state.actionError
                    ? { id: 77, status: "error", error: { code: "invalid_input", message: state.actionError } }
                    : { id: 77, status: "success", error: null },
            });
        }
        return json({ error: { code: "not_found", message: `the stand-in does not answer ${method} ${path}` } }, 404);
    };
    return { api: new HetznerApi(MARKER_TOKEN, { fetchImpl, endpoint: "http://hetzner.stand-in.invalid/v1", actionPollMs: 1 }), calls, fetchImpl };
}

/** The firewall a launch created for `server`, still with its first rule for 22. */
export function launchFirewall(server: string, serverId = 3001, id = 1001): HetznerFirewall {
    return {
        id,
        name: "coolify",
        labels: { purpose: "coolify", server },
        rules: [{ direction: "in", protocol: "tcp", port: "22", source_ips: ["0.0.0.0/0", "::/0"], destination_ips: [], description: "SSH until the tailnet is proved (removed in Phase B)" }],
        applied_to: [{ type: "server", server: { id: serverId } }],
    };
}

export function launchServer(server: string, id = 3001): HetznerServer {
    return { id, name: server, labels: { purpose: "coolify", server }, public_net: { ipv4: { ip: "203.0.113.10" } } };
}

/**
 * A shell on the server that answers from a table. `answer` gets each
 * command and returns what the box would print; the stand-in records every
 * command, so a test can say which ones ran.
 */
export function fakeRemote(
    answer: (command: string) => Partial<SshProbeResult> & { stdout?: string },
    where = "root@100.64.0.7",
): Remote & { commands: string[] } {
    const commands: string[] = [];
    const probe = (command: string) => {
        commands.push(command);
        const a = answer(command);
        return { ok: a.ok ?? true, status: a.status ?? 0, stdout: a.stdout ?? "", stderr: a.stderr ?? "", timedOut: a.timedOut ?? false };
    };
    return {
        where,
        commands,
        probe,
        run: (command) => {
            const r = probe(command);
            if (!r.ok) throw new Error(`stand-in: ${command.slice(0, 40)} failed`);
            return r.stdout;
        },
    };
}

/** What the box facts probe prints for a box set up as the launch leaves it. */
export function boxFactsOutput(over: Record<string, string | string[]> = {}): string {
    const base: Record<string, string | string[]> = {
        env: "yes", env_mode: "600", bashrc: "yes", token: "unset", node: "v22.12.0",
        git: "yes", jq: "yes", claude: "yes", skills: "yes", clutter: [], coolify: "yes", localhost: "yes",
        ...over,
    };
    const lines: string[] = [];
    for (const [k, v] of Object.entries(base)) {
        if (Array.isArray(v)) for (const item of v) lines.push(`${k}=${item}`);
        else lines.push(`${k}=${v}`);
    }
    return lines.join("\n") + "\n";
}
