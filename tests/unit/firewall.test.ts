// The lane firewall: the six combinations of public lane and dashboard
// exposure equal the table in docs/server-model.md exactly, GitHub's hook
// ranges come from a fixture of GitHub's meta answer, the Hetzner calls go to
// a stand-in, and the probe runs against ports on this computer only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import {
    applyLaneFirewall,
    expectedProbe,
    fetchGithubHooks,
    laneRules,
    parseGithubHooks,
    probeAll,
    probeMismatches,
    probePort,
    RULE_DESCRIPTIONS,
    sameRules,
    type Fetch,
    type FirewallRule,
} from "../../lib/hetzner-firewall.js";
import { fakeHetzner, GITHUB_META, launchFirewall, MARKER_TOKEN } from "./helpers/stand-ins.js";

const ANY = ["0.0.0.0/0", "::/0"];
const HOOKS = GITHUB_META.hooks;
const http: FirewallRule = { direction: "in", protocol: "tcp", port: "80", source_ips: ANY, description: "public lane: ACME + redirect" };
const https: FirewallRule = { direction: "in", protocol: "tcp", port: "443", source_ips: ANY, description: "public lane: Traefik" };
const github: FirewallRule = { direction: "in", protocol: "tcp", port: "8000", source_ips: HOOKS, description: "Coolify: GitHub webhooks" };
const internet: FirewallRule = { direction: "in", protocol: "tcp", port: "8000", source_ips: ANY, description: "Coolify dashboard (internet mode)" };

const SIX: Array<[string, "tailnet" | "github" | "internet", FirewallRule[]]> = [
    ["none", "tailnet", []],
    ["none", "github", [github]],
    ["none", "internet", [internet]],
    ["apps.example.com", "tailnet", [http, https]],
    ["apps.example.com", "github", [http, https, github]],
    ["apps.example.com", "internet", [http, https, internet]],
];

test("the six lane combinations equal the table exactly", () => {
    for (const [public_lane, dashboard, expected] of SIX) {
        assert.deepEqual(laneRules({ public_lane, dashboard }, HOOKS), expected, `${public_lane} + ${dashboard}`);
    }
});

test("tailnet mode with no public lane sends an empty list, and no combination opens 22 or anything outbound", () => {
    assert.deepEqual(laneRules({ public_lane: "none", dashboard: "tailnet" }), []);
    for (const [public_lane, dashboard] of SIX) {
        for (const r of laneRules({ public_lane, dashboard }, HOOKS)) {
            assert.equal(r.direction, "in");
            assert.ok(!["22", "3000", "6001", "6002"].includes(r.port), `${r.port} opened in ${public_lane} + ${dashboard}`);
        }
    }
});

test("github mode refuses to build without the hook ranges", () => {
    assert.throws(() => laneRules({ public_lane: "none", dashboard: "github" }), /hook ranges/);
    assert.throws(() => laneRules({ public_lane: "none", dashboard: "github" }, []), /hook ranges/);
});

test("the descriptions are the ones docs/server-model.md lists", () => {
    const doc = readFileSync(new URL("../../docs/server-model.md", import.meta.url), "utf8");
    for (const d of Object.values(RULE_DESCRIPTIONS)) assert.ok(doc.includes(d), `docs/server-model.md lacks "${d}"`);
});

test("the hook ranges are read from GitHub's meta answer, and nothing wider is accepted", async () => {
    assert.deepEqual(parseGithubHooks(GITHUB_META), HOOKS);
    for (const bad of [{}, { hooks: [] }, { hooks: ["192.30.252.0"] }, { hooks: ["0.0.0.0/0"] }, { hooks: ["::/0"] }, { hooks: ["10.0.0.0/33"] }, { hooks: [7] }]) {
        assert.throws(() => parseGithubHooks(bad), /hooks/, JSON.stringify(bad));
    }
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl: Fetch = async (input, init) => {
        seen.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization") });
        return new Response(JSON.stringify(GITHUB_META), { status: 200 });
    };
    assert.deepEqual(await fetchGithubHooks(fetchImpl), HOOKS);
    assert.deepEqual(seen, [{ url: "https://api.github.com/meta", auth: null }]);
    await assert.rejects(fetchGithubHooks(async () => new Response("", { status: 403 })), /answered 403/);
});

test("the probe expectation follows the table for every combination", () => {
    for (const [public_lane, dashboard] of SIX) {
        const e = expectedProbe({ public_lane, dashboard });
        const lane = public_lane === "none" ? "closed" : "open";
        assert.deepEqual(e, {
            22: "closed", 80: lane, 443: lane, 3000: "closed",
            8000: dashboard === "internet" ? "open" : "closed", 6001: "closed", 6002: "closed",
        });
    }
});

test("a probe of this computer tells an open port from a closed one", async () => {
    const open = createServer((s) => s.destroy());
    await new Promise<void>((res) => open.listen(0, "127.0.0.1", res));
    const openPort = (open.address() as AddressInfo).port;
    const gone = createServer();
    await new Promise<void>((res) => gone.listen(0, "127.0.0.1", res));
    const closedPort = (gone.address() as AddressInfo).port;
    await new Promise<void>((res) => gone.close(() => res()));
    try {
        assert.equal(await probePort("127.0.0.1", openPort, 1_000), "open");
        assert.equal(await probePort("127.0.0.1", closedPort, 1_000), "closed");
    } finally {
        open.close();
    }
});

test("a probe that differs from the table names each port", async () => {
    const actual = await probeAll("203.0.113.10", async (_h, p) => (p === 22 || p === 8000 ? "open" : "closed"));
    assert.deepEqual(probeMismatches(actual, expectedProbe({ public_lane: "none", dashboard: "github" })), [
        "port 22 reads open, expected closed",
        "port 8000 reads open, expected closed",
    ]);
});

test("set_rules replaces the rules on the launchpad's firewall and reads them back", async () => {
    const { api, calls } = fakeHetzner({ firewalls: [launchFirewall("alpha")], servers: [], runningPolls: 2 });
    const rules = laneRules({ public_lane: "none", dashboard: "github" }, HOOKS);
    const after = await applyLaneFirewall(api, "alpha", 3001, rules);
    assert.ok(sameRules(after.rules, rules));
    assert.ok(!after.rules.some((r) => r.port === "22"), "22 is still open");
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
        "GET /firewalls?name=coolify",
        "POST /firewalls/1001/actions/set_rules",
        "GET /firewalls/actions/77",
        "GET /firewalls/actions/77",
        "GET /firewalls/actions/77",
        "GET /firewalls/1001",
    ]);
    assert.deepEqual(calls[1].body, { rules });
    assert.ok(calls.every((c) => c.auth === `Bearer ${MARKER_TOKEN}`));
});

test("tailnet mode with no public lane sends an empty rule list", async () => {
    const { api, calls } = fakeHetzner({ firewalls: [launchFirewall("alpha")], servers: [] });
    const after = await applyLaneFirewall(api, "alpha", 3001, laneRules({ public_lane: "none", dashboard: "tailnet" }));
    assert.deepEqual(calls[1].body, { rules: [] });
    assert.deepEqual(after.rules, []);
});

test("a firewall called coolify that the launchpad did not make for this server is left alone", async () => {
    for (const fw of [
        { ...launchFirewall("alpha"), labels: {} },
        { ...launchFirewall("alpha"), labels: { purpose: "coolify", server: "beta" } },
        launchFirewall("alpha", 9999),
    ]) {
        const { api, calls } = fakeHetzner({ firewalls: [fw], servers: [] });
        await assert.rejects(applyLaneFirewall(api, "alpha", 3001, []), /Refusing to change the firewall/);
        assert.ok(!calls.some((c) => c.method === "POST"), "a POST was sent");
    }
});

test("a read-back that differs, a refused action, or a missing firewall stops the step", async () => {
    const rules = laneRules({ public_lane: "none", dashboard: "internet" });
    const differs = fakeHetzner({ firewalls: [launchFirewall("alpha")], servers: [], readBackRules: [] });
    await assert.rejects(applyLaneFirewall(differs.api, "alpha", 3001, rules), /read back differently/);
    const refused = fakeHetzner({ firewalls: [launchFirewall("alpha")], servers: [], actionError: "too many rules" });
    await assert.rejects(applyLaneFirewall(refused.api, "alpha", 3001, rules), /Hetzner refused the rules: too many rules/);
    const none = fakeHetzner({ firewalls: [], servers: [] });
    await assert.rejects(applyLaneFirewall(none.api, "alpha", 3001, rules), /no Hetzner firewall named coolify/);
});

test("a Hetzner error never carries the token", async () => {
    const { api } = fakeHetzner({ firewalls: [], servers: [] });
    const wrong = new (api.constructor as typeof import("../../lib/hetzner-firewall.js").HetznerApi)("another-marker", {
        fetchImpl: async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "unable to authenticate" } }), { status: 401 }),
        endpoint: "http://hetzner.stand-in.invalid/v1",
    });
    await assert.rejects(wrong.firewallByName("coolify"), (err: Error) => {
        assert.match(err.message, /401: unauthorized unable to authenticate/);
        assert.ok(!err.message.includes("another-marker"));
        return true;
    });
});
