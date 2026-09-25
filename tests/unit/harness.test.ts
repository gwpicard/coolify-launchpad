// The SSH harness and the printed output: the options that keep a recycled
// address from being refused, the tailnet leg proving the grant rather than a
// key, the staged key never outliving its step, and the failure block format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { shellSingleQuote, sshArgs, withStagedKey, pollUntil } from "../../lib/ssh.js";
import { step } from "../../lib/progress.js";
import type { ProgressEvent } from "../../lib/progress.js";
import { humanDuration, makeProgressRenderer, renderStopped } from "../../scripts/output.js";

test("shellSingleQuote survives a single quote", () => {
    assert.equal(shellSingleQuote("it's"), `'it'\\''s'`);
});

test("both legs remember no host key", () => {
    for (const target of [{ host: "203.0.113.5", user: "root", keyPath: "/tmp/k" }, { host: "100.64.0.1", user: "root" }]) {
        const a = sshArgs(target, []).join(" ");
        assert.match(a, /StrictHostKeyChecking=no/);
        assert.match(a, /UserKnownHostsFile=\/dev\/null/);
        assert.match(a, /BatchMode=yes/);
    }
});

test("leg one uses only its key, and leg two uses no key or password at all", () => {
    const one = sshArgs({ host: "203.0.113.5", user: "root", keyPath: "/tmp/k" }, []).join(" ");
    assert.match(one, /-i \/tmp\/k -o IdentitiesOnly=yes/);
    const two = sshArgs({ host: "100.64.0.1", user: "root" }, []).join(" ");
    assert.ok(!two.includes("-i "));
    assert.match(two, /PubkeyAuthentication=no/);
    assert.match(two, /PasswordAuthentication=no/);
});

test("a staged key is mode 600 during the step and gone afterwards, even when the step throws", async () => {
    let seen = "";
    await assert.rejects(
        withStagedKey("-----BEGIN MARKER-----\n", async (keyPath) => {
            seen = keyPath;
            assert.equal(statSync(keyPath).mode & 0o777, 0o600);
            throw new Error("boom");
        }),
        /boom/,
    );
    assert.ok(seen);
    assert.ok(!existsSync(seen));
    assert.ok(!existsSync(dirname(seen)));
});

test("the poll stops at its deadline and names what it waited for", async () => {
    await assert.rejects(
        pollUntil(() => ({ done: false, last: "still booting" }), { timeoutMs: 30, intervalMs: 10, what: "the thing" }),
        /the thing did not happen within 0 minutes. Last check: still booting/,
    );
    assert.equal(await pollUntil(() => ({ done: true, value: 7 }), { timeoutMs: 30, intervalMs: 10, what: "x" }), 7);
    await assert.rejects(pollUntil(() => ({ fail: "stop now" }), { timeoutMs: 30, intervalMs: 10, what: "x" }), /stop now/);
});

test("step emits started then done or failed, with the error's first line", async () => {
    const events: ProgressEvent[] = [];
    await step((e) => events.push(e), "A", () => 1, () => "detail");
    await assert.rejects(step((e) => events.push(e), "B", () => { throw new Error("first\nsecond"); }));
    assert.deepEqual(events.map((e) => [e.step, e.status, e.detail]), [
        ["A", "started", undefined], ["A", "done", "detail"], ["B", "started", undefined], ["B", "failed", "first"],
    ]);
});

test("the renderer numbers steps, and --json prints one object per line", () => {
    const lines: string[] = [];
    const r = makeProgressRenderer(false, (s) => lines.push(s));
    r({ step: "One", status: "started" });
    r({ step: "One", status: "done", durationMs: 65_000 });
    assert.deepEqual(lines, ["  [ 1] One…\n", "       ✓ One  1m 5s\n"]);
    const json: string[] = [];
    makeProgressRenderer(true, (s) => json.push(s))({ step: "One", status: "started" });
    assert.deepEqual(JSON.parse(json[0]), { type: "progress", step: "One", status: "started" });
    assert.equal(humanDuration(900), "900ms");
});

test("the failure block has the four lines docs/positioning.md gives", () => {
    assert.equal(
        renderStopped({ reached: "Verifying the tailnet node", finding: "refused", then: ["a", "b"] }),
        "Not launched yet, coolify-launchpad\nReached:   Verifying the tailnet node\nFinding:   refused\nThen:      a | b",
    );
});
