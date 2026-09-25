// /retire-server against stand-ins: it refuses anything the launchpad did not
// create, destroys nothing until the exact name is typed, logs the node out
// before the server goes, and hands over the console step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOGOUT_COMMAND, retireServer, renderRetired, stackOwnership, type RetireDeps } from "../../lib/retire.js";
import type { ProgressEvent } from "../../lib/progress.js";
import { fakeHetzner, fakeRemote, launchFirewall, launchServer } from "./helpers/stand-ins.js";

function stackExport(name = "alpha", over: { project?: string; extra?: object; serverLabels?: Record<string, string> } = {}) {
    const project = over.project ?? "coolify-launchpad";
    const urn = (type: string, n: string) => `urn:pulumi:${name}::${project}::${type}::${n}`;
    const labels = { purpose: "coolify", server: name };
    return {
        version: 3,
        deployment: {
            resources: [
                { urn: urn("pulumi:pulumi:Stack", `${project}-${name}`), type: "pulumi:pulumi:Stack" },
                { urn: urn("pulumi:providers:hcloud", "default"), type: "pulumi:providers:hcloud", id: "p1" },
                { urn: urn("tls:index/privateKey:PrivateKey", "coolify-ssh-key"), type: "tls:index/privateKey:PrivateKey", id: "k" },
                { urn: urn("hcloud:index/sshKey:SshKey", "coolify-ssh-key"), type: "hcloud:index/sshKey:SshKey", id: "2001", outputs: { labels } },
                { urn: urn("hcloud:index/firewall:Firewall", "coolify"), type: "hcloud:index/firewall:Firewall", id: "1001", outputs: { name: "coolify", labels } },
                {
                    urn: urn("hcloud:index/server:Server", "coolify-server"), type: "hcloud:index/server:Server", id: "3001",
                    outputs: { name, labels: over.serverLabels ?? labels, ipv4Address: "203.0.113.10" },
                },
                ...(over.extra ? [over.extra] : []),
            ],
        },
    };
}

test("a stack the launchpad made for the server passes, and each foreign sign is named", () => {
    assert.deepEqual(stackOwnership(stackExport(), "alpha"), { problems: [], serverId: 3001, firewallId: 1001, publicIp: "203.0.113.10" });
    assert.match(stackOwnership(stackExport("alpha", { project: "someone-else" }), "alpha").problems[0], /not in stack alpha of project coolify-launchpad/);
    assert.match(
        stackOwnership(stackExport("alpha", { extra: { urn: "urn:pulumi:alpha::coolify-launchpad::aws:s3/bucket:Bucket::b", type: "aws:s3/bucket:Bucket" } }), "alpha").problems[0],
        /aws:s3\/bucket:Bucket resource, which the launchpad never creates/,
    );
    assert.match(stackOwnership(stackExport("alpha", { serverLabels: {} }), "alpha").problems[0], /labels purpose=coolify and server=alpha/);
    assert.match(stackOwnership(stackExport("alpha"), "beta").problems[0], /not in stack beta/);
    assert.deepEqual(stackOwnership({}, "alpha").problems, ["the stack export holds no resource list"]);
});

interface Trace {
    deps: RetireDeps;
    did: string[];
    events: ProgressEvent[];
    box: ReturnType<typeof fakeRemote>;
    calls: ReturnType<typeof fakeHetzner>["calls"];
}

function trace(over: Partial<RetireDeps> & { typed?: string; servers?: ReturnType<typeof launchServer>[]; firewalls?: ReturnType<typeof launchFirewall>[]; answersAfterLogout?: boolean } = {}): Trace {
    const did: string[] = [];
    let loggedOut = false;
    const box = fakeRemote((c) => {
        if (c === LOGOUT_COMMAND) {
            loggedOut = true;
            did.push("logout");
            return { stdout: "logout=scheduled\n" };
        }
        if (c === "true") return loggedOut && !over.answersAfterLogout ? { ok: false, status: 255 } : {};
        throw new Error(`unexpected command ${c}`);
    });
    const hetzner = fakeHetzner({ firewalls: over.firewalls ?? [launchFirewall("alpha")], servers: over.servers ?? [launchServer("alpha")] });
    const deps: RetireDeps = {
        stackExists: () => true,
        stackExport: () => stackExport(),
        hetzner: hetzner.api,
        tailnetIpOf: () => "100.64.0.7",
        remote: () => box,
        confirm: async (warning) => {
            did.push(`asked: ${warning}`);
            return over.typed ?? "alpha";
        },
        destroy: () => void did.push("destroy"),
        removeStack: () => void did.push("stack rm"),
        removeRecords: () => {
            did.push("records");
            return ["servers/alpha.block.txt", "servers/alpha.yaml"];
        },
        logoutWaitMs: 50,
        ...over,
    };
    return { deps, did, events: [], box, calls: hetzner.calls };
}

test("the typed name, then logout, then destroy, then the stack, then the records, and the console step last", async () => {
    const t = trace();
    const r = await retireServer("alpha", t.deps, (e) => t.events.push(e));
    assert.equal(t.did.length, 5);
    assert.match(t.did[0], /^asked: This destroys the server alpha \(public IP 203\.0\.113\.10\), its disk with \/data\/coolify/);
    assert.deepEqual(t.did.slice(1), ["logout", "destroy", "stack rm", "records"]);
    assert.equal(r.loggedOut, true);
    assert.match(r.stillYours[0], /Tailscale admin console.*Remove/);
    assert.ok(t.calls.every((c) => c.method === "GET"), "the retire changed something through the Hetzner API itself");
    const text = renderRetired("alpha", r, ".env.alpha");
    assert.match(text, /Kept:        \.env\.alpha/);
    assert.ok(text.trimEnd().endsWith(r.stillYours[0]));
});

test("a wrong name, an empty answer or a near miss destroys nothing", async () => {
    for (const typed of ["", "alph", "Alpha", "alpha2", "beta"]) {
        const t = trace({ typed });
        await assert.rejects(retireServer("alpha", t.deps), /Nothing was destroyed/);
        assert.deepEqual(t.did.filter((d) => !d.startsWith("asked")), [], `typed "${typed}"`);
    }
});

test("no stack, a foreign stack, or a live server that is not the stack's is refused before the question", async () => {
    const cases: Array<[string, Partial<Parameters<typeof trace>[0]>, RegExp]> = [
        ["no stack", { stackExists: () => false }, /no Pulumi stack named alpha/],
        ["foreign project", { stackExport: () => stackExport("alpha", { project: "someone-else" }) }, /Refusing to retire alpha/],
        ["unlabelled server", { servers: [{ ...launchServer("alpha"), labels: {} }] }, /does not carry the labels/],
        ["another machine of that name", { servers: [launchServer("alpha", 4242)] }, /is 4242, but the stack holds 3001/],
        ["firewall relabelled", { firewalls: [{ ...launchFirewall("alpha"), labels: { purpose: "coolify", server: "beta" } }] }, /labelled for server beta/],
    ];
    for (const [why, over, pattern] of cases) {
        const t = trace(over);
        await assert.rejects(retireServer("alpha", t.deps), pattern, why);
        assert.deepEqual(t.did, [], `${why}: something happened after the refusal`);
    }
});

test("a server already gone from Hetzner, or a node this computer cannot find, still retires the rest", async () => {
    const t = trace({ servers: [], tailnetIpOf: () => undefined });
    const events: ProgressEvent[] = [];
    const r = await retireServer("alpha", t.deps, (e) => events.push(e));
    assert.deepEqual(t.did.slice(1), ["destroy", "stack rm", "records"]);
    assert.equal(r.loggedOut, false);
    assert.ok(events.some((e) => e.status === "skipped" && /cannot find alpha on the tailnet/.test(e.detail ?? "")));
    assert.ok(events.some((e) => e.status === "done" && /already gone from Hetzner/.test(e.detail ?? "")));
});

test("a node that still answers after logout does not stop the retire, and the console step still comes", async () => {
    const t = trace({ answersAfterLogout: true });
    const r = await retireServer("alpha", t.deps);
    assert.equal(r.loggedOut, false);
    assert.deepEqual(t.did.slice(1), ["logout", "destroy", "stack rm", "records"]);
    assert.equal(r.stillYours.length, 1);
});

test("logout runs detached, because it drops the session it runs in", () => {
    assert.match(LOGOUT_COMMAND, /^setsid nohup sh -c 'sleep 2; tailscale logout'/);
});
