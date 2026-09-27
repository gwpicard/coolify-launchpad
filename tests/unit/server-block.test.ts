// The server block and the failure block, against the formats
// docs/positioning.md owns: every field renders, in the template's order, and
// the failure block renders from a thrown step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { envFileScript } from "../../lib/phase-b.js";
import {
    blockPath,
    ENV_FILE,
    githubAppLink,
    githubWebhookUrl,
    isDuckDns,
    TOKEN_LINE_COMMAND,
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

test("the Next line follows the token: a new session resumes at step 2 only while the token is still to fill", () => {
    const toFill = renderServerBlock(facts);
    assert.match(toFill, /\n {16}once the token is in the env file, a new session resumes at its step 2$/);
    const set = renderServerBlock({ ...facts, envTokenSet: true });
    assert.match(set, /\n {16}the token is already in the env file, so it goes on to its step 2$/);
    assert.ok(!/once the token is in the env file/.test(set), "the Next line waits for a token that is already set");
});

test("a public lane adds the DNS item and the Wildcard Domain item, worded for DuckDNS when the suffix is one", () => {
    const own = stillYoursToDo({ ...facts, spec: { ...spec, public_lane: "apps.example.com" } });
    assert.ok(own.some((s) => /DNS token and the wildcard record for \*\.apps\.example\.com/.test(s)));
    const duck = stillYoursToDo({ ...facts, spec: { ...spec, public_lane: "team-x.duckdns.org" } });
    const dns = duck.find((s) => /precondition 4/.test(s));
    assert.ok(dns, "no DNS item for a DuckDNS lane");
    assert.match(dns, /^The DuckDNS token, for coolify-devops's DuckDNS updater/);
    assert.match(dns, /No wildcard record is needed/);
    assert.ok(!/\*\.team-x/.test(dns), `a DuckDNS lane is asked for a wildcard record: ${dns}`);
    for (const items of [own, duck]) {
        const wild = items.find((s) => /Wildcard Domain/.test(s));
        assert.ok(wild, "no Wildcard Domain item for a public lane");
        assert.match(wild, /Servers, localhost, General/);
        assert.match(wild, /cannot write it/);
    }
    assert.match(duck.find((s) => /Wildcard Domain/.test(s)) ?? "", /to https:\/\/team-x\.duckdns\.org,/);
    assert.ok(!stillYoursToDo(facts).some((s) => /Wildcard Domain|precondition 4/.test(s)), "no public lane, yet a lane item");
    assert.ok(isDuckDns("duckdns.org") && isDuckDns("a.duckdns.org"));
    assert.ok(!isDuckDns("notduckdns.org") && !isDuckDns("duckdns.org.example.com"));
});

test("the list of what is still yours marks nothing done and follows the answers", () => {
    const base = stillYoursToDo(facts);
    assert.ok(base.some((s) => /Coolify API token/.test(s) && /never root/.test(s) && /never goes into a chat/.test(s)));
    assert.ok(base.some((s) => /Sign in to Claude Code/.test(s)));
    assert.ok(base.some((s) => /precondition 3/.test(s)));
    assert.ok(base.some((s) => /GitHub App/.test(s)));
    assert.ok(!base.some((s) => /DNS token/.test(s)));
    assert.ok(!base.some((s) => /\b(done|✓)\b/i.test(s)));
    const other = stillYoursToDo({ ...facts, envTokenSet: true, spec: { ...spec, public_lane: "apps.example.com", dashboard: "tailnet", install_tooling: false } });
    assert.ok(!other.some((s) => /Coolify API token/.test(s)));
    assert.ok(other.some((s) => /Install Node 22/.test(s)));
    assert.ok(other.some((s) => /DNS token/.test(s) && /\*\.apps\.example\.com/.test(s)));
    assert.ok(!other.some((s) => /GitHub App/.test(s)));
    assert.ok(base.some((s) => /Never the launchpad's own token/.test(s)));
});

test("the GitHub App item points at Coolify's manual route and never at opening 8000 to your own IP", () => {
    for (const dashboard of ["github", "internet"] as const) {
        const items = stillYoursToDo({ ...facts, spec: { ...spec, dashboard } });
        const item = items.find((s) => /the GitHub App, by Coolify's manual route/.test(s));
        const finish = items.find((s) => /^Then finish the GitHub App in Coolify/.test(s));
        assert.ok(item, `no GitHub side item in ${dashboard} mode`);
        assert.ok(finish, `no Coolify side item in ${dashboard} mode`);
        assert.equal(items.indexOf(finish), items.indexOf(item) + 1, "the Coolify side does not follow the GitHub side");
        assert.match(item, /"Continue manually"/);
        assert.ok(item.includes("https://github.com/settings/apps/new"), item);
        const link = githubAppLink("alpha", "http://100.64.0.7:8000", "203.0.113.10");
        assert.ok(item.includes(` ${link} `), `the pre-filled link is missing: ${item}`);
        assert.match(item, /Type a long random webhook secret into the form yourself; the link leaves it out/);
        assert.ok(item.includes("http://203.0.113.10:8000/webhooks/source/github/events"), item);
        assert.match(item, /contents read, metadata read, pull requests write and emails read/);
        assert.match(item, /events push and pull_request/);
        assert.match(item, /Sources, \+ Add, a name, Continue, then "Continue manually"/);
        assert.ok(finish.includes("https://coolify.io/docs/applications/sources/github/app"), finish);
        assert.match(item, /homepage URL/);
        assert.match(item, /long random webhook secret/);
        assert.match(finish, /same webhook secret/);
        assert.match(item, /client secret and a private key/);
        assert.match(item, /install the App on your repositories/);
        assert.match(finish, /Keys & Tokens, Private Keys/);
        assert.match(finish, /App ID/);
        assert.match(finish, /Installation ID \(the number after \/installations\//);
        assert.match(finish, /Client ID/);
        for (const s of [item, finish]) {
            assert.ok(!/callback|setup URL/i.test(s), `a callback or setup URL is asked for: ${s}`);
            assert.ok(!/own (public )?IP|8000 rule|provisioning\.md|remove it afterwards/i.test(s), `the old advice is back: ${s}`);
        }
        assert.match(item, /with no firewall change/);
        assert.ok(!/hook ranges[^.]*enough/i.test(item), "the push delivery is claimed before a run proved it");
        assert.match(item, /"Register With GitHub"/);
        assert.match(item, /plain HTTP, and not signed in if you use Coolify over the tailnet/);
        assert.ok(!/because you sign in over the tailnet/.test(item), "a reason that is false in internet mode");
    }
    assert.equal(githubWebhookUrl("198.51.100.4"), "http://198.51.100.4:8000/webhooks/source/github/events");
});

test("the GitHub App link uses the parameter names a real run proved, encodes the values, and carries no secret", () => {
    assert.equal(
        githubAppLink("alpha", "http://100.64.0.7:8000", "203.0.113.10"),
        "https://github.com/settings/apps/new?name=alpha&url=http%3A%2F%2F100.64.0.7%3A8000" +
            "&webhook_active=true&webhook_url=http%3A%2F%2F203.0.113.10%3A8000%2Fwebhooks%2Fsource%2Fgithub%2Fevents" +
            "&public=false&contents=read&metadata=read&pull_requests=write&emails=read&events[]=push&events[]=pull_request",
    );
    assert.ok(!/secret/i.test(githubAppLink("alpha", "http://100.64.0.7:8000", "203.0.113.10")));
    assert.match(githubAppLink("a b&c", "http://x", "203.0.113.10"), /\?name=a%20b%26c&/);
});

test("the token item gives the exact single-quoted line to append, and warns against overwriting the env file", () => {
    assert.equal(
        TOKEN_LINE_COMMAND,
        `read -rsp 'Coolify token: ' T && printf "export COOLIFY_ACCESS_TOKEN='%s'\\n" "$T" >> ` +
            `/root/.config/coolify-devops.env && unset T; echo`,
    );
    const item = stillYoursToDo(facts).find((s) => /Coolify API token/.test(s));
    assert.ok(item, "no token item");
    assert.ok(item.endsWith(TOKEN_LINE_COMMAND), item);
    assert.match(item, /Open a shell on the server \(not inside Claude Code\), run this command and paste the token when asked: /);
    assert.match(item, /paste the token when asked/);
    assert.ok(!/<paste token>/.test(item), "the command still needs a placeholder edited");
    assert.match(item, /<id>\|<secret>/);
    assert.match(item, /overwrite the env file/);
    assert.match(item, /cat >/);
    assert.ok(!/add it to \S+ on the server with the command/.test(item), "the old pointer is back");
});

test("the token line appended to the env file the launch wrote sources a <id>|<secret> token intact", () => {
    const home = mkdtempSync(join(tmpdir(), "token-line-"));
    try {
        const made = spawnSync("bash", ["-c", envFileScript("http://localhost:8000", home)], { encoding: "utf8" });
        assert.equal(made.status, 0, made.stderr);
        const file = join(home, ".config", "coolify-devops.env");
        const standIn = "7|stand-in-not-a-token";
        const append = TOKEN_LINE_COMMAND.replace(ENV_FILE, file);
        const r = spawnSync(
            "bash",
            ["-c", `${append}\n. '${file}' && [ "$COOLIFY_ACCESS_TOKEN" = '${standIn}' ] && [ -z "\${T:-}" ] && echo match`],
            { encoding: "utf8", input: `${standIn}\n` },
        );
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), "match");
        assert.ok(!r.stdout.includes(standIn) && !r.stderr.includes(standIn), "the token was echoed");
        assert.match(readFileSync(file, "utf8"), /^export COOLIFY_BASE_URL=http:\/\/localhost:8000$/m);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test("the list notes that claude -p will not bypass permissions as root, and that the account's connectors load", () => {
    for (const install_tooling of [true, false]) {
        const items = stillYoursToDo({ ...facts, spec: { ...spec, install_tooling } });
        const item = items.find((s) => /^(Sign in to Claude Code|Install Node 22)/.test(s));
        assert.ok(item, `no Claude Code item with install_tooling ${install_tooling}`);
        assert.match(item, /claude -p refuses --permission-mode bypassPermissions/);
        assert.match(item, /as root/);
        assert.match(item, /allow-list/);
        assert.match(item, /personal claude\.ai connectors/);
    }
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
