// The server block and the failure block, against the formats
// docs/positioning.md owns: every field renders, in the template's order, and
// the failure block renders from a thrown step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    blockPath,
    renderHandOver,
    renderServerBlock,
    renderStopped,
    stillYoursToDo,
    stoppedFor,
    writeHandOver,
    type ServerBlockFacts,
} from "../../lib/server-block.js";
import type { ServerSpec } from "../../lib/spec.js";

const spec: ServerSpec = {
    name: "alpha",
    hetzner: { location: "nbg1", type: "cpx22" },
    public_lane: "none",
    dashboard: "github",
    install_tooling: true,
};

const facts: ServerBlockFacts = {
    spec,
    publicIp: "203.0.113.10",
    tailnetIp: "100.64.0.7",
    dnsName: "alpha.tail1234.ts.net",
    coolifyUrl: "http://localhost:8000",
    twoFactorConfirmed: false,
    adminCheck: "register-closed",
    envMode: "600",
    envTokenSet: false,
    nodeVersion: "v22.12.0",
};

function templateLabels(): string[] {
    const doc = readFileSync(new URL("../../docs/positioning.md", import.meta.url), "utf8");
    const block = doc.split("## The server block")[1].split("```")[1];
    return block.split("\n").map((l) => /^([A-Z][A-Za-z ]+):\s/.exec(l)?.[1]).filter((l): l is string => Boolean(l));
}

test("the block carries every label of the template in docs/positioning.md, in order", () => {
    const labels = templateLabels();
    assert.ok(labels.length >= 9, `the template parse found ${labels.join(", ")}`);
    const rendered = renderServerBlock(facts).split("\n").map((l) => /^([A-Z][A-Za-z ]+):\s/.exec(l)?.[1]).filter(Boolean);
    assert.deepEqual(rendered, labels);
});

test("the block renders every field for the campaign's answers: cpx22, nbg1, github, no public lane, tooling", () => {
    const b = renderServerBlock(facts);
    assert.ok(b.startsWith("Launched by coolify-launchpad\n"));
    for (const needle of [
        "Coolify:        http://localhost:8000 on the host   (from the tailnet: http://100.64.0.7:8000)",
        "Server:         Hetzner cpx22, nbg1, Ubuntu 24.04, public IP 203.0.113.10",
        "Tailnet:        alpha.tail1234.ts.net, tag:server, key expiry disabled, Tailscale SSH on",
        "Public lane:    none",
        "Dashboard:      github (8000 open to GitHub's hook ranges)",
        'Firewall:       Hetzner firewall "coolify", 22 closed; probe from the operator\'s machine matched the expectation table',
        "Env file:       /root/.config/coolify-devops.env, mode 600, sourced by .bashrc; the token line is still to fill",
        "On the box:     Node 22, git, jq, Claude Code, coolify-devops skills in /root",
        "Next:           on the server, run /setup-coolify-devops",
    ]) {
        assert.ok(b.includes(needle), `missing: ${needle}\n${b}`);
    }
});

test("each answer changes its own line", () => {
    const pub = renderServerBlock({ ...facts, spec: { ...spec, public_lane: "apps.example.com", dashboard: "tailnet", install_tooling: false } });
    assert.match(pub, /Public lane:    apps\.example\.com \(80 and 443 open\)/);
    assert.match(pub, /Dashboard:      tailnet\n/);
    assert.match(pub, /On the box:     git, jq only/);
    const open = renderServerBlock({ ...facts, spec: { ...spec, dashboard: "internet" }, twoFactorConfirmed: true });
    assert.match(open, /Dashboard:      internet \(8000 open; 2FA confirmed by you, not verified\)/);
    const ipv4 = renderServerBlock({ ...facts, coolifyUrl: "http://127.0.0.1:8000", envTokenSet: true, adminCheck: "confirmed-by-you" });
    assert.match(ipv4, /Coolify:        http:\/\/127\.0\.0\.1:8000 on the host/);
    assert.match(ipv4, /the token line is set/);
    assert.match(ipv4, /confirmed by you, not verified/);
});

test("the list of what is still yours marks nothing done and follows the answers", () => {
    const base = stillYoursToDo(facts);
    assert.ok(base.some((s) => /Coolify API token/.test(s) && /never root/.test(s) && /never goes into a chat/.test(s)));
    assert.ok(base.some((s) => /Sign in to Claude Code/.test(s)));
    assert.ok(base.some((s) => /precondition 3/.test(s)));
    assert.ok(base.some((s) => /GitHub App/.test(s) && /your own public IP/.test(s)));
    assert.ok(!base.some((s) => /DNS token/.test(s)));
    assert.ok(!base.some((s) => /\b(done|✓)\b/i.test(s)));
    const other = stillYoursToDo({ ...facts, envTokenSet: true, spec: { ...spec, public_lane: "apps.example.com", dashboard: "tailnet", install_tooling: false } });
    assert.ok(!other.some((s) => /Coolify API token/.test(s)));
    assert.ok(other.some((s) => /Install Node 22/.test(s)));
    assert.ok(other.some((s) => /DNS token/.test(s) && /\*\.apps\.example\.com/.test(s)));
    assert.ok(!other.some((s) => /GitHub App/.test(s)));
    assert.ok(base.some((s) => /Never the launchpad's own token/.test(s)));
});

test("the hand-over is the block, then the list, and it is written to servers/<name>.block.txt", () => {
    const text = renderHandOver(facts);
    assert.ok(text.startsWith(renderServerBlock(facts)));
    assert.match(text, /\n\nStill yours to do\n- /);
    const dir = mkdtempSync(join(tmpdir(), "block-test-"));
    try {
        const path = writeHandOver("alpha", dir, text);
        assert.equal(path, blockPath("alpha", dir));
        assert.ok(path.endsWith(join("servers", "alpha.block.txt")));
        assert.equal(readFileSync(path, "utf8"), `${text}\n`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("a thrown step renders the failure block, with resume and retire once a server may exist", () => {
    const err = new Error("The probe from this computer does not match the expectation table: port 22 reads open\nmore detail");
    const after = renderStopped(stoppedFor(err, "Applying the lane firewall", "alpha", true));
    assert.equal(
        after,
        [
            "Not launched yet, coolify-launchpad",
            "Reached:   Applying the lane firewall",
            "Finding:   The probe from this computer does not match the expectation table: port 22 reads open",
            "Then:      npm run launch -- --server alpha --resume | /retire-server alpha",
        ].join("\n"),
    );
    const before = stoppedFor(new Error("pulumi missing"), "nothing yet", "alpha", false);
    assert.deepEqual(before.then, ["fix the finding, then npm run launch -- --server alpha"]);
});
