// Phase B steps 1 and 2 judged against saved answers from a node: what counts
// as a finished Phase A, and what counts as a node coolify-devops will accept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTailnet } from "../../lib/tailnet.js";
import { readPhaseA, judgePhaseA, PHASE_A_PROBE } from "../../lib/phase-b.js";

const goodStatus = {
    BackendState: "Running",
    MagicDNSSuffix: "tail1234.ts.net",
    CertDomains: ["alpha.tail1234.ts.net"],
    CurrentTailnet: { Name: "example.org", MagicDNSSuffix: "tail1234.ts.net", MagicDNSEnabled: true },
    Self: { HostName: "alpha", DNSName: "alpha.tail1234.ts.net.", Tags: ["tag:server"] },
};
const sshOn = JSON.stringify({ RunSSH: true });

function check(status: object, prefs = sshOn) {
    return checkTailnet(JSON.stringify(status), prefs, "alpha");
}

test("a signed-in, tagged node with no key expiry, MagicDNS, HTTPS and SSH passes", () => {
    const r = check(goodStatus);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.facts, { suffix: "tail1234.ts.net", dnsName: "alpha.tail1234.ts.net" });
    assert.deepEqual(check({ ...goodStatus, Self: { ...goodStatus.Self, KeyExpiry: null } }).problems, []);
});

test("each missing property is reported on its own", () => {
    const cases: Array<[object, string, RegExp]> = [
        [{ ...goodStatus, BackendState: "NeedsLogin" }, sshOn, /not signed in/],
        [{ ...goodStatus, Self: { ...goodStatus.Self, Tags: null } }, sshOn, /not tagged tag:server/],
        [{ ...goodStatus, Self: { ...goodStatus.Self, KeyExpiry: "2027-01-01T00:00:00Z" } }, sshOn, /key expires/],
        [goodStatus, JSON.stringify({ RunSSH: false }), /Tailscale SSH is off/],
        [{ ...goodStatus, MagicDNSSuffix: "" }, sshOn, /MagicDNS is off/],
        [{ ...goodStatus, CurrentTailnet: { MagicDNSEnabled: false } }, sshOn, /MagicDNS is off/],
        [{ ...goodStatus, CertDomains: null }, sshOn, /HTTPS certificates are off/],
        [{ ...goodStatus, Self: { ...goodStatus.Self, DNSName: "alpha-1.tail1234.ts.net." } }, sshOn, /joined as alpha-1/],
    ];
    for (const [status, prefs, pattern] of cases) {
        const r = checkTailnet(JSON.stringify(status), prefs, "alpha");
        assert.equal(r.problems.length, 1, JSON.stringify(r.problems));
        assert.match(r.problems[0], pattern);
        assert.equal(r.facts, undefined);
    }
});

test("an answer that is not JSON is named", () => {
    assert.throws(() => checkTailnet("not json", sshOn, "alpha"), /tailscale status --json did not return JSON/);
});

test("the Phase A probe is read by key", () => {
    assert.match(PHASE_A_PROBE, /phase-a-done/);
    assert.deepEqual(readPhaseA("cloud-init=done\nsentinel=yes\ncoolify=yes\n"), { cloudInit: "done", sentinel: true, coolify: true });
    assert.deepEqual(readPhaseA("coolify=no\ncloud-init=running\nsentinel=no"), { cloudInit: "running", sentinel: false, coolify: false });
});

test("Phase A is done only with the sentinel and Coolify answering, and an error stops the wait", () => {
    const done = judgePhaseA({ cloudInit: "done", sentinel: true, coolify: true });
    assert.ok("done" in done && done.done);
    const waiting = judgePhaseA({ cloudInit: "done", sentinel: true, coolify: false });
    assert.ok("done" in waiting && !waiting.done);
    const failed = judgePhaseA({ cloudInit: "error", sentinel: false, coolify: false });
    assert.ok("fail" in failed);
    assert.match(failed.fail, /cloud-init-output\.log/);
});
