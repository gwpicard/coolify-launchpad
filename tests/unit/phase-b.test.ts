// Phase B steps 4 to 9, offline. The env file script runs for real against a
// folder of this computer's own, because "written once, never overwritten" is
// a property of the shell it runs, not of the TypeScript around it. The whole
// order of steps runs against stand-ins for the server, Hetzner and GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    BOX_FACTS_PROBE,
    identityProblems,
    NODE_IDENTITY_PROBE,
    readNodeIdentity,
    envFileScript,
    installSkills,
    readBoxFacts,
    REGISTER_PROBE,
    SKILLS_INSTALL,
    toolingProblems,
    waitForAdmin,
} from "../../lib/phase-b.js";
import { chooseFirstLeg, phaseB, registrationOpenFinding, twoFactorFinding, type PhaseBDeps, type PhaseBInput } from "../../lib/launch-flow.js";
import { laneRules } from "../../lib/hetzner-firewall.js";
import type { ProgressEvent } from "../../lib/progress.js";
import type { ServerSpec } from "../../lib/spec.js";
import { stoppedFor } from "../../lib/server-block.js";
import { boxFactsOutput, fakeHetzner, fakeRemote, GITHUB_META, launchFirewall } from "./helpers/stand-ins.js";

function withHome(fn: (home: string) => void): void {
    const home = mkdtempSync(join(tmpdir(), "phase-b-home-"));
    try {
        fn(home);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
}

async function withHomeAsync(fn: (home: string) => Promise<void>): Promise<void> {
    const home = mkdtempSync(join(tmpdir(), "phase-b-home-"));
    try {
        await fn(home);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
}

function runLocally(script: string): string {
    const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
}

test("the env file is written once at mode 600, sourced once, and holds no token", () => {
    withHome((home) => {
        const first = runLocally(envFileScript("http://localhost:8000", home));
        assert.match(first, /env=written/);
        assert.match(first, /mode=600/);
        const file = join(home, ".config", "coolify-devops.env");
        assert.equal(statSync(file).mode & 0o777, 0o600);
        const body = readFileSync(file, "utf8");
        assert.match(body, /^export COOLIFY_BASE_URL=http:\/\/localhost:8000$/m);
        assert.match(body, /^# export COOLIFY_ACCESS_TOKEN=<token>/m);
        assert.ok(!/^export COOLIFY_ACCESS_TOKEN/m.test(body), "the token line is live");
        assert.ok(!/HCLOUD_TOKEN/.test(body), "the launchpad's Hetzner token reached the env file");

        const second = runLocally(envFileScript("http://127.0.0.1:8000", home));
        assert.match(second, /env=kept/);
        assert.equal(readFileSync(file, "utf8"), body, "a second run changed the file");
        const bashrc = readFileSync(join(home, ".bashrc"), "utf8");
        assert.equal(bashrc.match(/coolify-devops\.env/g)?.length, 1, "the source line was added twice");
        assert.equal(bashrc.trim(), ". ~/.config/coolify-devops.env");
    });
});

test("an env file the person already filled is left byte for byte, and so is a .bashrc that sources it", () => {
    withHome((home) => {
        mkdirSync(join(home, ".config"), { mode: 0o700 });
        const file = join(home, ".config", "coolify-devops.env");
        const theirs = "export COOLIFY_BASE_URL=http://localhost:8000\nexport COOLIFY_ACCESS_TOKEN=marker-not-a-token\n";
        writeFileSync(file, theirs, { mode: 0o600 });
        writeFileSync(join(home, ".bashrc"), "grep -q coolify-devops.env ~/.bashrc\n. ~/.config/coolify-devops.env\n");
        const out = runLocally(envFileScript("http://localhost:8000", home));
        assert.match(out, /env=kept/);
        assert.ok(!out.includes("marker-not-a-token"), "the script printed the file");
        assert.equal(readFileSync(file, "utf8"), theirs);
        assert.equal(readFileSync(join(home, ".bashrc"), "utf8").match(/\. ~\/\.config/g)?.length, 1);
    });
});

test("the env file takes only the two URLs the launch can choose", () => {
    assert.throws(() => envFileScript("http://100.64.0.7:8000"), /not a URL/);
    assert.throws(() => envFileScript("http://localhost:8000; rm -rf /"), /not a URL/);
});

test("the box facts probe checks the token for presence and never prints a value", () => {
    assert.match(BOX_FACTS_PROBE, /\[ -n "\$\{COOLIFY_ACCESS_TOKEN:-\}" \]/);
    assert.ok(!/\bcat\b|env \|\s*grep|echo "?\$COOLIFY_ACCESS_TOKEN|printenv/.test(BOX_FACTS_PROBE));
    const f = readBoxFacts(boxFactsOutput({ clutter: ["AGENTS.md", "docs"], token: "set", node: "" }));
    assert.deepEqual(f.clutter, ["AGENTS.md", "docs"]);
    assert.equal(f.tokenSet, true);
    assert.equal(f.nodeVersion, "");
});

test("step 6 refuses a /root the scaffolder would refuse, and missing tooling when it was asked for", () => {
    assert.deepEqual(toolingProblems(readBoxFacts(boxFactsOutput()), true), []);
    assert.match(toolingProblems(readBoxFacts(boxFactsOutput({ clutter: ["CLAUDE.md"] })), true)[0], /\/root holds CLAUDE\.md/);
    const bare = readBoxFacts(boxFactsOutput({ node: "", claude: "no", skills: "no" }));
    assert.deepEqual(toolingProblems(bare, false), []);
    assert.equal(toolingProblems(bare, true).length, 3);
    assert.match(toolingProblems(readBoxFacts(boxFactsOutput({ node: "v16.20.0" })), true)[0], /needs 18 or newer/);
});

test("step 4 waits until /register stops answering 200, and otherwise names --admin-created", async () => {
    const codes = ["000", "200", "200", "302"];
    const box = fakeRemote((c) => (c === REGISTER_PROBE ? { stdout: codes.shift() ?? "302" } : {}));
    assert.equal(await waitForAdmin(box, "alpha", { timeoutMs: 1_000, intervalMs: 1 }), "302");
    const never = fakeRemote(() => ({ stdout: "200" }));
    await assert.rejects(waitForAdmin(never, "alpha", { timeoutMs: 20, intervalMs: 5 }), /--resume --admin-created/);
});

test("step 6 installs the skills once, and a failure quotes the end of its log", () => {
    const installed = fakeRemote(() => ({ stdout: "skills=installed\n" }));
    assert.equal(installSkills(installed), "installed");
    assert.deepEqual(installed.commands, [SKILLS_INSTALL]);
    assert.match(SKILLS_INSTALL, /cd \/root/);
    assert.match(SKILLS_INSTALL, /if \[ -f \/root\/skills-lock\.json \]; then echo skills=kept; exit 0; fi/);
    assert.match(SKILLS_INSTALL, /npx -y skills add KasperHonore\/coolify-devops -a claude-code -y/);
    assert.equal(installSkills(fakeRemote(() => ({ stdout: "skills=kept\n" }))), "kept");
    const failed = fakeRemote(() => ({ ok: false, status: 1, stdout: "skills=failed\nlog=npm ERR! network\n" }));
    assert.throws(() => installSkills(failed), /npm ERR! network/);
});

// The whole of Phase B against stand-ins.

const spec: ServerSpec = { name: "alpha", hetzner: { location: "nbg1", type: "cpx22" }, public_lane: "none", dashboard: "github", install_tooling: true };

interface World {
    deps: PhaseBDeps;
    events: ProgressEvent[];
    calls: ReturnType<typeof fakeHetzner>["calls"];
    box: ReturnType<typeof fakeRemote>;
    written: string[];
    home: string;
    hooksFetched: number;
}

function world(
    home: string,
    opts: { probe?: (port: number) => "open" | "closed"; hetznerFirewalls?: ReturnType<typeof launchFirewall>[]; identity?: string; register?: string | string[] } = {},
): World {
    const hetzner = fakeHetzner({ firewalls: opts.hetznerFirewalls ?? [launchFirewall("alpha")], servers: [] });
    const written: string[] = [];
    const w = { events: [] as ProgressEvent[], calls: hetzner.calls, written, home, hooksFetched: 0 } as World;
    // The env file script is run for real against `home`; every other command gets the box as a launch leaves it.
    // A list of /register codes is answered in turn, and its last code stays.
    const codes = Array.isArray(opts.register) ? [...opts.register] : [opts.register ?? "302"];
    w.box = fakeRemote((c) => {
        if (c === NODE_IDENTITY_PROBE) return { stdout: opts.identity ?? "instance_id=3001\npublic_ip=203.0.113.10\n" };
        if (c === REGISTER_PROBE) return { stdout: codes.length > 1 ? codes.shift()! : codes[0] };
        if (c.includes("coolify-devops.env") && c.startsWith("set -eu")) {
            const local = c.replaceAll("'/root/", `'${home}/`);
            return { stdout: runLocally(local) };
        }
        if (c === SKILLS_INSTALL) return { stdout: existsSync(join(home, "skills-lock.json")) ? "skills=kept\n" : "skills=installed\n" };
        if (c === BOX_FACTS_PROBE) return { stdout: boxFactsOutput() };
        throw new Error(`the stand-in box was asked something unexpected: ${c.slice(0, 60)}`);
    });
    w.deps = {
        waitForPhaseA: async () => ({ localhostAnswers: true }),
        verifyTailnet: () => ({ suffix: "tail1234.ts.net", dnsName: "alpha.tail1234.ts.net", tailnetIp: "100.64.0.7", publicIpSeen: "203.0.113.10" }),
        proveSshGrant: async (ip) => ({ host: ip, user: "root" }),
        remote: () => w.box,
        hetzner: hetzner.api,
        fetchGithubHooks: async () => {
            w.hooksFetched += 1;
            return GITHUB_META.hooks;
        },
        probePort: async (_h, p) => (opts.probe ? opts.probe(p) : "closed"),
        httpStatus: async () => 302,
        writeHandOver: (_s, text) => {
            written.push(text);
            return "servers/alpha.block.txt";
        },
        timing: { adminIntervalMs: 1, adminTimeoutMs: 100, probeIntervalMs: 1, probeTimeoutMs: 20 },
    };
    return w;
}

function input(over: Partial<PhaseBInput> = {}): PhaseBInput {
    return { spec, publicIp: "203.0.113.10", serverId: 3001, firstLeg: { host: "203.0.113.10", user: "root", keyPath: "/k" }, adminCreated: false, twoFactorOn: false, ...over };
}

test("a launch in github mode with no public lane runs every step in order and ends in the block", async () => {
    await withHomeAsync(async (home) => {
        const w = world(home, { register: ["200", "200", "302"] });
        const result = await phaseB(input(), w.deps, (e) => w.events.push(e));
        const done_ = w.events.filter((e) => e.status === "done").map((e) => e.step);
        assert.deepEqual(done_, [
            "Waiting for cloud-init to finish and Coolify to answer (up to 20 minutes)",
            "Verifying the tailnet node",
            "Checking that the node is this Hetzner server",
            "Proving the SSH grant from this computer",
            "Waiting for the Coolify admin account",
            "Writing /root/.config/coolify-devops.env",
            "Installing the coolify-devops skills in /root",
            "Checking /root and the tools on the box",
            "Reading GitHub's webhook ranges",
            'Applying the lane firewall to "coolify" (22 closes)',
            "Probing the public IP from this computer",
            "Reaching Coolify over the tailnet from this computer",
            "Writing servers/alpha.block.txt",
        ]);
        const asked = w.events.find((e) => e.status === "started" && e.ask);
        assert.match(asked?.ask ?? "", /Open http:\/\/100\.64\.0\.7:8000 from this computer now/);
        assert.match(asked?.ask ?? "", /Fill in every field, use a strong password \(at least 8 characters, with upper and lower case letters, a number and a symbol, and not one found in a known data breach\)/);
        assert.match(asked?.ask ?? "", /submit the form once/);
        assert.match(asked?.ask ?? "", /after an HTTP 429, wait two minutes before you try again/);
        const post = w.calls.find((c) => c.method === "POST");
        assert.deepEqual(post?.body, { rules: laneRules(spec, GITHUB_META.hooks) });
        assert.equal(w.written.length, 1);
        assert.equal(result.text, w.written[0]);
        assert.match(result.text, /Dashboard:      github \(8000 open to GitHub's hook ranges\)/);
        assert.match(result.text, /mode 600/);
    });
});

test("a resume leaves the env file untouched and the skills install skipped", async () => {
    await withHomeAsync(async (home) => {
        const w = world(home);
        await phaseB(input(), w.deps);
        const file = join(home, ".config", "coolify-devops.env");
        const before = readFileSync(file, "utf8");
        writeFileSync(join(home, "skills-lock.json"), "{}");
        const again = world(home);
        const events: ProgressEvent[] = [];
        await phaseB(input({ firstLeg: { host: "100.64.0.7", user: "root" } }), again.deps, (e) => events.push(e));
        assert.equal(readFileSync(file, "utf8"), before);
        assert.match(events.find((e) => e.step.startsWith("Writing /root") && e.status === "done")?.detail ?? "", /left untouched/);
        assert.equal(events.find((e) => e.step.startsWith("Installing") && e.status === "done")?.detail, "already installed");
    });
});

test("the admin ask comes only while /register answers 200, so a resume after the account exists does not repeat it", async () => {
    const asks = async (home: string, register: string[], over: Partial<PhaseBInput> = {}) => {
        const w = world(home, { register });
        await phaseB(input(over), w.deps, (e) => w.events.push(e));
        return w.events.filter((e) => e.step === "Waiting for the Coolify admin account" && e.status === "started");
    };
    await withHomeAsync(async (home) => {
        const fresh = await asks(home, ["200", "200", "302"]);
        assert.equal(fresh.length, 1);
        assert.match(fresh[0].ask ?? "", /create the Coolify admin account/);
    });
    await withHomeAsync(async (home) => {
        const resumed = await asks(home, ["302"], { firstLeg: { host: "100.64.0.7", user: "root" } });
        assert.equal(resumed.length, 1);
        assert.equal(resumed[0].ask, undefined, "a resume asked for an account that already exists");
    });
    await withHomeAsync(async (home) => {
        const silent = await asks(home, ["000", "302"]);
        assert.match(silent[0].ask ?? "", /create the Coolify admin account/, "no answer from /register was read as an account");
    });
});

test("tailnet mode with no public lane sends no rules and never asks GitHub", async () => {
    await withHomeAsync(async (home) => {
        const w = world(home);
        await phaseB(input({ spec: { ...spec, dashboard: "tailnet" } }), w.deps);
        assert.equal(w.hooksFetched, 0);
        assert.deepEqual(w.calls.find((c) => c.method === "POST")?.body, { rules: [] });
    });
});

test("internet mode stops before the firewall until the person has said 2FA is on", async () => {
    await withHomeAsync(async (home) => {
        const w = world(home);
        await assert.rejects(phaseB(input({ spec: { ...spec, dashboard: "internet" } }), w.deps), (err: Error) => {
            assert.equal(err.message, twoFactorFinding("alpha"));
            return true;
        });
        assert.ok(!w.calls.some((c) => c.method === "POST"), "the firewall changed before 2FA was confirmed");
        const ok = world(home, { probe: (p) => (p === 8000 ? "open" : "closed") });
        const r = await phaseB(input({ spec: { ...spec, dashboard: "internet" }, twoFactorOn: true }), ok.deps);
        assert.match(r.text, /2FA confirmed by you, not verified/);
    });
});

test("the tooling step is skipped when the spec says no, and the block says so", async () => {
    await withHomeAsync(async (home) => {
        const w = world(home);
        const events: ProgressEvent[] = [];
        const r = await phaseB(input({ spec: { ...spec, install_tooling: false } }), w.deps, (e) => events.push(e));
        assert.ok(events.some((e) => e.status === "skipped" && e.step.startsWith("Installing")));
        assert.ok(!w.box.commands.includes(SKILLS_INSTALL));
        assert.match(r.text, /On the box:     git, jq only/);
        assert.ok(r.stillYours.some((s) => /Install Node 22/.test(s)));
    });
});

test("a probe that does not match stops the launch with the failure block, after the firewall", async () => {
    await withHomeAsync(async (home) => {
        const w = world(home, { probe: (p) => (p === 22 ? "open" : "closed") });
        let reached = "nothing yet";
        const err = await phaseB(input(), w.deps, (e) => {
            if (e.status === "done") reached = e.step;
        }).then(() => undefined, (e: unknown) => e);
        assert.ok(err instanceof Error);
        const stopped = stoppedFor(err, reached, "alpha", true);
        assert.equal(stopped.reached, 'Applying the lane firewall to "coolify" (22 closes)');
        assert.match(stopped.finding, /port 22 reads open, expected closed/);
        assert.deepEqual(stopped.then, ["npm run launch -- --server alpha --resume", "/retire-server alpha"]);
    });
});

test("--admin-created skips the wait and the block says the account was confirmed by the person", async () => {
    await withHomeAsync(async (home) => {
        const w = world(home);
        const r = await phaseB(input({ adminCreated: true }), w.deps);
        assert.ok(!w.box.commands.includes(REGISTER_PROBE));
        assert.match(r.text, /confirmed by you, not verified/);
    });
});

test("a tailnet machine that is not the stack's server stops the launch before anything changes", async () => {
    for (const identity of [
        "instance_id=3001\npublic_ip=198.51.100.4\n",
        "instance_id=4242\npublic_ip=203.0.113.10\n",
        "instance_id=\npublic_ip=\n",
    ]) {
        await withHomeAsync(async (home) => {
            const w = world(home, { identity });
            await assert.rejects(phaseB(input({ firstLeg: { host: "100.64.0.7", user: "root" } }), w.deps), /cannot be shown to be this server|another machine/);
            assert.ok(!w.box.commands.includes(REGISTER_PROBE), "it went on to the admin wait");
            assert.ok(!w.calls.some((c) => c.method === "POST"), "it changed the firewall");
            assert.ok(!existsSync(join(home, ".config")), "it wrote the env file");
        });
    }
});

test("the identity check reads the node's answer, and an instance id it cannot read is not held against it", () => {
    const expected = { name: "alpha", publicIp: "203.0.113.10", serverId: 3001 };
    assert.deepEqual(identityProblems(readNodeIdentity("instance_id=\npublic_ip=203.0.113.10\n"), expected), []);
    assert.deepEqual(identityProblems(readNodeIdentity("instance_id=3001\npublic_ip=203.0.113.10\n"), expected), []);
    assert.match(identityProblems(readNodeIdentity("public_ip=198.51.100.4\n"), expected)[0], /leaves from 198\.51\.100\.4/);
    assert.match(NODE_IDENTITY_PROBE, /169\.254\.169\.254\/hetzner\/v1\/metadata\/instance-id/);
});

test("internet mode with --admin-created refuses to open 8000 while registration is still open", async () => {
    await withHomeAsync(async (home) => {
        const open = world(home, { register: "200" });
        const internet = { ...spec, dashboard: "internet" as const };
        await assert.rejects(phaseB(input({ spec: internet, adminCreated: true, twoFactorOn: true }), open.deps), (err: Error) => {
            assert.equal(err.message, registrationOpenFinding("alpha"));
            return true;
        });
        assert.ok(!open.calls.some((c) => c.method === "POST"), "8000 opened with registration open");
        const closed = world(home, { register: "302", probe: (p) => (p === 8000 ? "open" : "closed") });
        await phaseB(input({ spec: internet, adminCreated: true, twoFactorOn: true }), closed.deps);
        assert.ok(closed.calls.some((c) => c.method === "POST"));
    });
});

test("a resume goes over the tailnet, falls back to 22 only while it is open, and fails fast once it is closed", async () => {
    const look = (ip: string | undefined, port22: "open" | "closed") => ({ tailnetIpOf: () => ip, probePort: async () => port22 });
    assert.deepEqual(await chooseFirstLeg(false, "alpha", "203.0.113.10", look(undefined, "closed")), { kind: "public" });
    assert.deepEqual(await chooseFirstLeg(true, "alpha", "203.0.113.10", look("100.64.0.7", "closed")), { kind: "tailnet", host: "100.64.0.7" });
    assert.deepEqual(await chooseFirstLeg(true, "alpha", "203.0.113.10", look(undefined, "open")), { kind: "public" });
    const started = Date.now();
    await assert.rejects(chooseFirstLeg(true, "alpha", "203.0.113.10", look(undefined, "closed")), /port 22 on 203\.0\.113\.10 is closed/);
    assert.ok(Date.now() - started < 1_000);
});
