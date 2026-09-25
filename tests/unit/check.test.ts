// /check-server against stand-ins: it reports broken things first, it reads
// and never writes (only GET requests to Hetzner, only read commands on the
// box), and it shows the saved block again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkServer, renderCheck, type CheckDeps } from "../../lib/check.js";
import { BOX_FACTS_PROBE, NODE_IDENTITY_PROBE } from "../../lib/phase-b.js";
import { laneRules } from "../../lib/hetzner-firewall.js";
import type { ServerSpec } from "../../lib/spec.js";
import { boxFactsOutput, fakeHetzner, fakeRemote, GITHUB_META, launchFirewall } from "./helpers/stand-ins.js";

const spec: ServerSpec = { name: "alpha", hetzner: { location: "nbg1", type: "cpx22" }, public_lane: "none", dashboard: "github", install_tooling: true };

const STATUS = JSON.stringify({
    BackendState: "Running",
    MagicDNSSuffix: "tail1234.ts.net",
    CertDomains: ["alpha.tail1234.ts.net"],
    Self: { HostName: "alpha", DNSName: "alpha.tail1234.ts.net.", Tags: ["tag:server"] },
});

/** The commands /check-server may send to the box. Each only reads. */
const READ_ONLY = new Set(["true", NODE_IDENTITY_PROBE, "tailscale status --json", "tailscale debug prefs", BOX_FACTS_PROBE]);

function deps(over: { rules?: ReturnType<typeof laneRules>; box?: string; tailnetIp?: string | null; probe8000?: "open" | "closed"; grant?: boolean; identity?: string } = {}) {
    const fw = launchFirewall("alpha");
    fw.rules = over.rules ?? laneRules(spec, GITHUB_META.hooks);
    const hetzner = fakeHetzner({ firewalls: [fw], servers: [] });
    const box = fakeRemote((c) => {
        if (c === "true") return over.grant === false ? { ok: false, status: 255, stderr: "tailnet policy does not permit you to SSH" } : {};
        if (c === NODE_IDENTITY_PROBE) return { stdout: over.identity ?? "instance_id=3001\npublic_ip=203.0.113.10\n" };
        if (c === "tailscale status --json") return { stdout: STATUS };
        if (c === "tailscale debug prefs") return { stdout: JSON.stringify({ RunSSH: true }) };
        if (c === BOX_FACTS_PROBE) return { stdout: over.box ?? boxFactsOutput() };
        throw new Error(`unexpected command ${c}`);
    });
    const d: CheckDeps = {
        stack: () => ({ publicIp: "203.0.113.10", serverId: 3001 }),
        tailnetIpOf: () => (over.tailnetIp === null ? undefined : (over.tailnetIp ?? "100.64.0.7")),
        remote: () => box,
        hetzner: hetzner.api,
        fetchGithubHooks: async () => GITHUB_META.hooks,
        probePort: async (_h, p) => (p === 8000 ? (over.probe8000 ?? "closed") : "closed"),
        httpStatus: async () => 302,
        readBlock: () => "Launched by coolify-launchpad\n(the saved block)",
    };
    return { d, calls: hetzner.calls, box };
}

test("a server as the launch left it reads back with nothing broken, and the token is a to-do", async () => {
    const { d } = deps();
    const r = await checkServer(spec, d);
    assert.equal(r.broken, 0, JSON.stringify(r.rows, null, 1));
    assert.equal(r.rows[0].status, "to do");
    assert.equal(r.rows[0].what, "COOLIFY_ACCESS_TOKEN");
    const text = renderCheck("alpha", r);
    assert.match(text, /read only; nothing was changed/);
    assert.ok(text.trimEnd().endsWith("(the saved block)"), "the block is not shown again at the end");
});

test("the check only reads: GET requests to Hetzner and read commands on the box", async () => {
    const { d, calls, box } = deps();
    await checkServer(spec, d);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((c) => c.method === "GET"), calls.map((c) => c.method).join(","));
    assert.ok(box.commands.every((c) => READ_ONLY.has(c)), box.commands.join("\n"));
});

test("a changed rule set, an open 8000 and a loose env file are broken, and come first", async () => {
    const { d } = deps({
        rules: laneRules({ public_lane: "none", dashboard: "internet" }),
        probe8000: "open",
        box: boxFactsOutput({ env_mode: "644" }),
    });
    const r = await checkServer(spec, d);
    assert.equal(r.broken, 3);
    assert.deepEqual(r.rows.slice(0, 3).map((x) => x.what), ['The Hetzner firewall "coolify"', "The probe from this computer", "/root/.config/coolify-devops.env"]);
    assert.match(r.rows[1].detail, /port 8000 reads open, expected closed/);
    assert.match(r.rows[2].detail, /chmod 600/);
});

test("when this computer cannot reach the node, what depends on it is marked not checked", async () => {
    const lost = await checkServer(spec, deps({ tailnetIp: null }).d);
    assert.ok(lost.rows.some((x) => x.status === "broken" && /cannot find alpha on the tailnet/.test(x.detail)));
    assert.ok(lost.rows.some((x) => x.status === "not checked"));
    const refused = await checkServer(spec, deps({ grant: false }).d);
    assert.ok(refused.rows.some((x) => x.status === "broken" && x.what === "Tailscale SSH from this computer"));
});

test("without the tooling, missing Node and Claude Code are to-dos rather than faults", async () => {
    const { d } = deps({ box: boxFactsOutput({ node: "", claude: "no", skills: "no" }) });
    const without = await checkServer({ ...spec, install_tooling: false }, d);
    assert.equal(without.broken, 0);
    assert.ok(without.rows.some((x) => x.status === "to do" && x.what === "Node"));
    const withTooling = await checkServer(spec, deps({ box: boxFactsOutput({ node: "", claude: "no", skills: "no" }) }).d);
    assert.equal(withTooling.broken, 3);
});

test("a stale machine of the same name is reported, and nothing more is read from it", async () => {
    const { d, box } = deps({ identity: "instance_id=4242\npublic_ip=198.51.100.4\n" });
    let asked = false;
    d.httpStatus = async () => {
        asked = true;
        return 302;
    };
    const r = await checkServer(spec, d);
    assert.equal(r.rows[0].status, "broken");
    assert.equal(r.rows[0].what, "The tailnet machine is this server");
    assert.ok(r.rows.some((x) => x.status === "not checked" && /not this server/.test(x.detail)));
    assert.ok(!asked, "Coolify was asked on the other machine");
    assert.deepEqual(box.commands, ["true", NODE_IDENTITY_PROBE]);
});
