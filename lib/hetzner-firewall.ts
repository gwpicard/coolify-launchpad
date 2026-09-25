import { isIPv4, isIPv6, Socket } from "node:net";
import type { ServerSpec } from "./spec.js";

/**
 * The lane firewall: the inbound rules as a function of the two answers, the
 * GitHub hook ranges they may need, the Hetzner API calls that apply them, and
 * the outside probe that checks the result. docs/server-model.md owns the
 * tables this file implements.
 */

/** The firewall's name, which is coolify-devops's fixed `host.firewall_name`. */
export const FIREWALL_NAME = "coolify";

/** One inbound rule in the shape the Hetzner API takes and returns. */
export interface FirewallRule {
    direction: "in";
    protocol: "tcp";
    port: string;
    source_ips: string[];
    description: string;
}

const ANYWHERE = ["0.0.0.0/0", "::/0"];

/**
 * The descriptions are the ones coolify-devops's provisioning.md sends in its
 * own API call, word for word. /setup-coolify-devops compares a live rule set
 * with the one its runbook renders, so the same words keep that comparison
 * clean.
 */
export const RULE_DESCRIPTIONS = {
    http: "public lane: ACME + redirect",
    https: "public lane: Traefik",
    githubHooks: "Coolify: GitHub webhooks",
    internetDashboard: "Coolify dashboard (internet mode)",
} as const;

/** Hetzner accepts at most this many source addresses on one rule. */
export const MAX_SOURCES_PER_RULE = 100;

export type LaneAnswers = Pick<ServerSpec, "public_lane" | "dashboard">;

/**
 * The inbound rules for one pair of answers. 80 and 443 only with a public
 * lane; 8000 from GitHub's hook ranges in `github` mode, from anywhere in
 * `internet` mode; nothing else, and never 22. `tailnet` mode with no public
 * lane gives an empty list, which Hetzner reads as nothing inbound.
 */
export function laneRules(answers: LaneAnswers, githubHooks?: readonly string[]): FirewallRule[] {
    const rules: FirewallRule[] = [];
    if (answers.public_lane !== "none") {
        rules.push(rule("80", ANYWHERE, RULE_DESCRIPTIONS.http));
        rules.push(rule("443", ANYWHERE, RULE_DESCRIPTIONS.https));
    }
    if (answers.dashboard === "github") {
        if (!githubHooks || githubHooks.length === 0) {
            throw new Error("github mode needs GitHub's hook ranges, and none were given");
        }
        if (githubHooks.length > MAX_SOURCES_PER_RULE) {
            throw new Error(`GitHub lists ${githubHooks.length} hook ranges; a Hetzner rule takes at most ${MAX_SOURCES_PER_RULE}`);
        }
        rules.push(rule("8000", githubHooks, RULE_DESCRIPTIONS.githubHooks));
    } else if (answers.dashboard === "internet") {
        rules.push(rule("8000", ANYWHERE, RULE_DESCRIPTIONS.internetDashboard));
    }
    return rules;
}

function rule(port: string, sources: readonly string[], description: string): FirewallRule {
    return { direction: "in", protocol: "tcp", port, source_ips: [...sources], description };
}

// GitHub's hook ranges.

export const GITHUB_META_URL = "https://api.github.com/meta";

export type Fetch = typeof fetch;

function isCidr(value: string): boolean {
    const slash = value.indexOf("/");
    if (slash === -1) return false;
    const addr = value.slice(0, slash);
    const bits = value.slice(slash + 1);
    if (!/^\d{1,3}$/.test(bits)) return false;
    const n = Number(bits);
    if (isIPv4(addr)) return n <= 32;
    if (isIPv6(addr)) return n <= 128;
    return false;
}

/**
 * Read `hooks` out of GitHub's meta answer. Every entry must be an address
 * range, and there must be at least one: an empty or odd answer would give a
 * rule that lets nobody in, or anybody.
 */
export function parseGithubHooks(meta: unknown): string[] {
    const hooks = (meta as { hooks?: unknown } | null)?.hooks;
    if (!Array.isArray(hooks) || hooks.length === 0) {
        throw new Error(`${GITHUB_META_URL} gave no "hooks" list, so the github rule cannot be built`);
    }
    for (const h of hooks) {
        if (typeof h !== "string" || !isCidr(h) || h === "0.0.0.0/0" || h === "::/0") {
            throw new Error(`${GITHUB_META_URL} lists "${String(h)}" under hooks, which is not a narrow address range`);
        }
    }
    return [...hooks] as string[];
}

/** Fetch GitHub's published hook ranges. No token: the endpoint is public. */
export async function fetchGithubHooks(fetchImpl: Fetch = fetch): Promise<string[]> {
    const res = await fetchImpl(GITHUB_META_URL, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "coolify-launchpad" },
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${GITHUB_META_URL} answered ${res.status}`);
    return parseGithubHooks(await res.json());
}

// The Hetzner API.

export interface HetznerRuleOut extends Partial<FirewallRule> {
    destination_ips?: string[];
}

export interface HetznerFirewall {
    id: number;
    name: string;
    labels: Record<string, string>;
    rules: HetznerRuleOut[];
    applied_to: Array<{ type: string; server?: { id: number } }>;
}

export interface HetznerServer {
    id: number;
    name: string;
    labels: Record<string, string>;
    public_net?: { ipv4?: { ip?: string } | null };
}

interface HetznerAction {
    id: number;
    status: "running" | "success" | "error";
    error?: { code?: string; message?: string } | null;
}

export const DEFAULT_HETZNER_ENDPOINT = "https://api.hetzner.cloud/v1";

/**
 * A small client for the few Hetzner calls the launchpad makes. The token is
 * held in a private field and goes into the Authorization header and nowhere
 * else; no error message carries it. HCLOUD_ENDPOINT, which the Pulumi
 * provider also reads, moves every call elsewhere, and the offline tests
 * point it at a stand-in.
 */
export class HetznerApi {
    readonly #token: string;
    readonly #fetch: Fetch;
    readonly endpoint: string;
    readonly actionPollMs: number;

    constructor(token: string, opts: { fetchImpl?: Fetch; endpoint?: string; actionPollMs?: number } = {}) {
        if (!token) throw new Error("HCLOUD_TOKEN is not set");
        this.#token = token;
        this.#fetch = opts.fetchImpl ?? fetch;
        this.endpoint = (opts.endpoint ?? process.env.HCLOUD_ENDPOINT ?? DEFAULT_HETZNER_ENDPOINT).replace(/\/$/, "");
        this.actionPollMs = opts.actionPollMs ?? 2_000;
    }

    async #call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
        const res = await this.#fetch(`${this.endpoint}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.#token}`,
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
        });
        const text = await res.text();
        if (!res.ok) {
            let why = text.slice(0, 200);
            try {
                const e = JSON.parse(text) as { error?: { code?: string; message?: string } };
                if (e.error) why = `${e.error.code ?? ""} ${e.error.message ?? ""}`.trim();
            } catch {
                // Keep the raw start of the answer.
            }
            throw new Error(`Hetzner API ${method} ${path.split("?")[0]} answered ${res.status}: ${why}`);
        }
        return (text ? JSON.parse(text) : {}) as T;
    }

    async firewallByName(name: string): Promise<HetznerFirewall | undefined> {
        const r = await this.#call<{ firewalls: HetznerFirewall[] }>("GET", `/firewalls?name=${encodeURIComponent(name)}`);
        return r.firewalls.find((f) => f.name === name);
    }

    async serverByName(name: string): Promise<HetznerServer | undefined> {
        const r = await this.#call<{ servers: HetznerServer[] }>("GET", `/servers?name=${encodeURIComponent(name)}`);
        return r.servers.find((s) => s.name === name);
    }

    async firewall(id: number): Promise<HetznerFirewall> {
        return (await this.#call<{ firewall: HetznerFirewall }>("GET", `/firewalls/${id}`)).firewall;
    }

    /** Replace the whole rule set, then wait for Hetzner to report it applied. */
    async setRules(id: number, rules: FirewallRule[], timeoutMs = 120_000): Promise<void> {
        const r = await this.#call<{ actions: HetznerAction[] }>("POST", `/firewalls/${id}/actions/set_rules`, { rules });
        const deadline = Date.now() + timeoutMs;
        for (const first of r.actions ?? []) {
            let action = first;
            while (action.status === "running") {
                if (Date.now() > deadline) throw new Error(`Hetzner did not finish applying the rules within ${timeoutMs / 1000} seconds`);
                await new Promise((res) => setTimeout(res, this.actionPollMs));
                action = (await this.#call<{ action: HetznerAction }>("GET", `/firewalls/actions/${action.id}`)).action;
            }
            if (action.status === "error") {
                throw new Error(`Hetzner refused the rules: ${action.error?.message ?? action.error?.code ?? "no reason given"}`);
            }
        }
    }
}

/**
 * The firewall must be the one this launch created: named `coolify`, carrying
 * the launchpad's labels for this server, and attached to this server. Any
 * other firewall called `coolify` belongs to somebody else, and its rules are
 * not ours to replace.
 */
export function ownershipProblems(fw: HetznerFirewall, server: string, serverId?: number): string[] {
    const problems: string[] = [];
    if (fw.name !== FIREWALL_NAME) problems.push(`the firewall is named ${fw.name}, not ${FIREWALL_NAME}`);
    if (fw.labels?.purpose !== "coolify" || fw.labels?.server !== server) {
        problems.push(
            `the firewall "${fw.name}" does not carry the labels purpose=coolify and server=${server}, ` +
            `so the launchpad did not create it for this server`,
        );
    }
    if (serverId !== undefined && !fw.applied_to?.some((a) => a.type === "server" && a.server?.id === serverId)) {
        problems.push(`the firewall "${fw.name}" is not attached to server ${serverId}`);
    }
    return problems;
}

/** Rules in a form two rule sets can be compared in: order and empty fields do not count. */
export function normaliseRules(rules: readonly HetznerRuleOut[]): string[] {
    return rules
        .map((r) =>
            JSON.stringify([r.direction, r.protocol, r.port ?? "", [...(r.source_ips ?? [])].sort(), r.description ?? ""]),
        )
        .sort();
}

export function sameRules(a: readonly HetznerRuleOut[], b: readonly HetznerRuleOut[]): boolean {
    const x = normaliseRules(a);
    const y = normaliseRules(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** One line per port, for a person reading a rule set. */
export function describeRules(rules: readonly HetznerRuleOut[]): string {
    if (rules.length === 0) return "no inbound rules";
    return rules.map((r) => `${r.protocol?.toUpperCase()} ${r.port} from ${(r.source_ips ?? []).length} source(s)`).join("; ");
}

/**
 * Phase B step 7. Find the firewall, refuse one the launchpad did not make,
 * replace its rules, and read them back. The read-back is the evidence.
 */
export async function applyLaneFirewall(
    api: HetznerApi,
    server: string,
    serverId: number,
    rules: FirewallRule[],
): Promise<HetznerFirewall> {
    const fw = await api.firewallByName(FIREWALL_NAME);
    if (!fw) throw new Error(`There is no Hetzner firewall named ${FIREWALL_NAME} in this project. The launch creates it; run it again.`);
    const problems = ownershipProblems(fw, server, serverId);
    if (problems.length > 0) throw new Error(`Refusing to change the firewall: ${problems.join("; ")}.`);
    await api.setRules(fw.id, rules);
    const after = await api.firewall(fw.id);
    if (!sameRules(after.rules, rules)) {
        throw new Error(
            `The firewall's rules read back differently from what was sent. Sent: ${describeRules(rules)}. ` +
            `Read back: ${describeRules(after.rules)}.`,
        );
    }
    return after;
}

// The outside probe.

/** The ports coolify-devops's setup step 2 and /health probe, in their order. */
export const PROBE_PORTS = [22, 80, 443, 3000, 8000, 6001, 6002] as const;
export type ProbePort = (typeof PROBE_PORTS)[number];
export type PortState = "open" | "closed";
export type ProbeResult = Record<ProbePort, PortState>;

/**
 * What the probe must read from the operator's machine. In `github` mode 8000
 * is open to GitHub's ranges only, so closed from here is the rule working.
 */
export function expectedProbe(answers: LaneAnswers): ProbeResult {
    const lane: PortState = answers.public_lane === "none" ? "closed" : "open";
    return {
        22: "closed",
        80: lane,
        443: lane,
        3000: "closed",
        8000: answers.dashboard === "internet" ? "open" : "closed",
        6001: "closed",
        6002: "closed",
    };
}

/** One TCP connection attempt, the same test as coolify-devops's `/dev/tcp` loop. */
export function probePort(host: string, port: number, timeoutMs = 3_000): Promise<PortState> {
    return new Promise((resolve) => {
        const socket = new Socket();
        const done = (state: PortState) => {
            socket.destroy();
            resolve(state);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done("open"));
        socket.once("timeout", () => done("closed"));
        socket.once("error", () => done("closed"));
        socket.connect(port, host);
    });
}

export async function probeAll(
    host: string,
    probe: (host: string, port: number) => Promise<PortState> = probePort,
): Promise<ProbeResult> {
    const states = await Promise.all(PROBE_PORTS.map((p) => probe(host, p)));
    return Object.fromEntries(PROBE_PORTS.map((p, i) => [p, states[i]])) as ProbeResult;
}

/** Each port that read differently from the table, as a line a person can act on. */
export function probeMismatches(actual: ProbeResult, expected: ProbeResult): string[] {
    return PROBE_PORTS.filter((p) => actual[p] !== expected[p]).map(
        (p) => `port ${p} reads ${actual[p]}, expected ${expected[p]}`,
    );
}

/**
 * `curl -sI <url>` from this computer: the HTTP status, or undefined when
 * nothing answered. Any status counts as an answer, since the point is that
 * Coolify is reachable over the tailnet, not what its front page says.
 */
export async function httpStatus(url: string, fetchImpl: Fetch = fetch, timeoutMs = 10_000): Promise<number | undefined> {
    try {
        const res = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
        return res.status;
    } catch {
        return undefined;
    }
}

/** The probe as one line, in the loop's own words. */
export function describeProbe(r: ProbeResult): string {
    return PROBE_PORTS.map((p) => `${p} ${r[p] === "open" ? "OPEN" : "closed"}`).join(", ");
}
