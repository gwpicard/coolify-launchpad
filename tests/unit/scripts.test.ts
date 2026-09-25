// The check and retire scripts as a person runs them, wired to stand-ins. A
// copy of the scripts runs in a throwaway folder with its own servers/ and
// .env file. `pulumi`, `ssh` and `tailscale` are stand-in commands on the
// PATH that log what they were asked, and HCLOUD_ENDPOINT points the Hetzner
// client at a stand-in on this computer. The spec uses `tailnet` mode, so
// nothing asks GitHub, and the stand-in tailscale finds no node for the check,
// so no request goes to a tailnet address. The probe goes to 203.0.113.10, an
// address reserved for documentation that no server holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fakeHetzner, launchFirewall, launchServer, MARKER_TOKEN } from "./helpers/stand-ins.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

const PULUMI = `#!/bin/sh
echo "$* backend=$PULUMI_BACKEND_URL token=$([ -n "$HCLOUD_TOKEN" ] && echo set || echo unset)" >> "$STAND_IN/pulumi.log"
case "$*" in
  version) echo v3.0.0-stand-in ;;
  "stack ls --json --non-interactive") echo '[{"name":"alpha"}]' ;;
  "stack export --stack alpha --non-interactive") cat "$STAND_IN/export.json" ;;
  "stack output ipv4Address --stack alpha --non-interactive") echo 203.0.113.10 ;;
  "stack output serverId --stack alpha --non-interactive") echo 3001 ;;
  "destroy --yes --skip-preview --stack alpha --non-interactive") echo destroyed ;;
  "stack rm alpha --yes --non-interactive") echo removed ;;
  *) echo "stand-in pulumi does not know: $*" >&2; exit 1 ;;
esac
`;

const SSH = `#!/bin/sh
for a; do last="$a"; done
printf '%s\\n' "$last" | head -n 1 >> "$STAND_IN/ssh.log"
case "$last" in
  -V) echo "OpenSSH stand-in" >&2 ;;
  'echo "instance_id='*) echo instance_id=3001; echo public_ip=203.0.113.10 ;;
  setsid*) touch "$STAND_IN/logged-out"; echo logout=scheduled ;;
  true) if [ -f "$STAND_IN/logged-out" ]; then exit 255; fi ;;
  *) echo "stand-in ssh does not know this command" >&2; exit 1 ;;
esac
`;

const TAILSCALE = `#!/bin/sh
echo "$*" >> "$STAND_IN/tailscale.log"
case "$*" in
  "ip -4 alpha") if [ -f "$STAND_IN/node-known" ]; then echo 100.64.0.7; else exit 1; fi ;;
  *) exit 0 ;;
esac
`;

interface Folder {
    repo: string;
    standIn: string;
}

function makeFolder(): Folder {
    const base = mkdtempSync(join(tmpdir(), "scripts-rehearsal-"));
    const repo = join(base, "repo");
    const standIn = join(base, "stand-in");
    mkdirSync(join(repo, "servers"), { recursive: true });
    mkdirSync(standIn);
    for (const d of ["lib", "scripts", "program"]) cpSync(join(root, d), join(repo, d), { recursive: true });
    symlinkSync(join(root, "node_modules"), join(repo, "node_modules"));
    writeFileSync(join(repo, "package.json"), readFileSync(join(root, "package.json")));
    writeFileSync(
        join(repo, "servers", "alpha.yaml"),
        "name: alpha\nhetzner:\n  location: nbg1\n  type: cpx22\npublic_lane: none\ndashboard: tailnet\ninstall_tooling: true\n",
    );
    writeFileSync(join(repo, "servers", "alpha.block.txt"), "Launched by coolify-launchpad\n(the saved block)\n");
    writeFileSync(
        join(repo, ".env.alpha"),
        // No TAILSCALE_AUTH_KEY: it is spent after the launch, and neither script needs it.
        `HCLOUD_TOKEN=${MARKER_TOKEN}\nPULUMI_CONFIG_PASSPHRASE=marker-passphrase\n`,
        { mode: 0o600 },
    );
    for (const [name, body] of [["pulumi", PULUMI], ["ssh", SSH], ["tailscale", TAILSCALE]] as const) {
        writeFileSync(join(standIn, name), body);
        chmodSync(join(standIn, name), 0o755);
    }
    const urn = (type: string, n: string) => `urn:pulumi:alpha::coolify-launchpad::${type}::${n}`;
    const labels = { purpose: "coolify", server: "alpha" };
    writeFileSync(join(standIn, "export.json"), JSON.stringify({
        deployment: {
            resources: [
                { urn: urn("pulumi:pulumi:Stack", "coolify-launchpad-alpha"), type: "pulumi:pulumi:Stack" },
                { urn: urn("hcloud:index/firewall:Firewall", "coolify"), type: "hcloud:index/firewall:Firewall", id: "1001", outputs: { name: "coolify", labels } },
                { urn: urn("hcloud:index/server:Server", "coolify-server"), type: "hcloud:index/server:Server", id: "3001", outputs: { name: "alpha", labels, ipv4Address: "203.0.113.10" } },
            ],
        },
    }));
    return { repo, standIn };
}

async function hetznerStandIn(): Promise<{ server: Server; endpoint: string; calls: ReturnType<typeof fakeHetzner>["calls"] }> {
    const fw = launchFirewall("alpha");
    fw.rules = [];
    const fake = fakeHetzner({ firewalls: [fw], servers: [launchServer("alpha")] });
    const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = Buffer.concat(chunks).toString();
        const answer = await fake.fetchImpl(`http://stand-in${req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: body || undefined,
        });
        res.writeHead(answer.status, { "Content-Type": "application/json" });
        res.end(await answer.text());
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { server, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, calls: fake.calls };
}

function run(f: Folder, endpoint: string, script: string, args: string[]): Promise<{ status: number | null; stdout: string }> {
    return new Promise((resolve) => {
        const child = spawn(join(root, "node_modules", ".bin", "tsx"), [join(f.repo, "scripts", script), ...args], {
            cwd: f.repo,
            env: { ...process.env, PATH: `${f.standIn}:${process.env.PATH}`, STAND_IN: f.standIn, HCLOUD_ENDPOINT: endpoint },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stdout += d));
        child.on("close", (status) => resolve({ status, stdout }));
    });
}

function log(f: Folder, name: string): string[] {
    const p = join(f.standIn, name);
    return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n") : [];
}

test("npm run retire refuses a wrong name, then retires with the right one and keeps the env file", { timeout: 60_000 }, async () => {
    const f = makeFolder();
    const h = await hetznerStandIn();
    try {
        writeFileSync(join(f.standIn, "node-known"), "");
        const wrong = await run(f, h.endpoint, "retire.ts", ["--server", "alpha", "--confirm", "alpah"]);
        assert.equal(wrong.status, 1);
        assert.match(wrong.stdout, /Nothing was destroyed/);
        assert.ok(!log(f, "pulumi.log").some((l) => l.startsWith("destroy") || l.startsWith("stack rm")), "a wrong name destroyed something");
        assert.deepEqual(log(f, "ssh.log"), [], "a wrong name logged the node out");

        const noAnswer = await run(f, h.endpoint, "retire.ts", ["--server", "alpha", "--json"]);
        assert.equal(noAnswer.status, 1);
        assert.match(noAnswer.stdout, /To go ahead, type the name/);

        const right = await run(f, h.endpoint, "retire.ts", ["--server", "alpha", "--confirm", "alpha"]);
        assert.equal(right.status, 0, right.stdout);
        const pulumi = log(f, "pulumi.log");
        const order = pulumi.map((l) => l.split(" backend=")[0]).filter((l) => /^(destroy|stack rm)/.test(l));
        assert.deepEqual(order, ["destroy --yes --skip-preview --stack alpha --non-interactive", "stack rm alpha --yes --non-interactive"]);
        assert.ok(pulumi.every((l) => l.includes(`backend=file://${join(realpathSync(f.repo), ".pulumi")}`)), "pulumi ran against another backend");
        assert.ok(pulumi.every((l) => l.endsWith("token=set")));
        assert.ok(log(f, "ssh.log").some((l) => l.startsWith("setsid nohup sh -c 'sleep 2; tailscale logout'")), log(f, "ssh.log").join("\n"));
        assert.ok(!existsSync(join(f.repo, "servers", "alpha.yaml")));
        assert.ok(!existsSync(join(f.repo, "servers", "alpha.block.txt")));
        assert.ok(existsSync(join(f.repo, ".env.alpha")), "the env file was removed");
        assert.match(right.stdout, /Tailscale admin console.*Remove/);
        assert.ok(!right.stdout.includes(MARKER_TOKEN) && !wrong.stdout.includes(MARKER_TOKEN));
        assert.ok(h.calls.every((c) => c.method === "GET"));
    } finally {
        h.server.close();
        rmSync(join(f.repo, ".."), { recursive: true, force: true });
    }
});

test("npm run retire refuses a stack that holds something the launchpad never creates", { timeout: 60_000 }, async () => {
    const f = makeFolder();
    const h = await hetznerStandIn();
    try {
        const exported = JSON.parse(readFileSync(join(f.standIn, "export.json"), "utf8"));
        exported.deployment.resources.push({ urn: "urn:pulumi:alpha::coolify-launchpad::aws:s3/bucket:Bucket::b", type: "aws:s3/bucket:Bucket" });
        writeFileSync(join(f.standIn, "export.json"), JSON.stringify(exported));
        const r = await run(f, h.endpoint, "retire.ts", ["--server", "alpha", "--confirm", "alpha"]);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /Refusing to retire alpha/);
        assert.ok(!log(f, "pulumi.log").some((l) => /^(destroy|stack rm)/.test(l)));
        assert.ok(existsSync(join(f.repo, "servers", "alpha.yaml")));
    } finally {
        h.server.close();
        rmSync(join(f.repo, ".."), { recursive: true, force: true });
    }
});

test("npm run check-server reads and changes nothing, then shows the block again", { timeout: 60_000 }, async () => {
    const f = makeFolder();
    const h = await hetznerStandIn();
    try {
        const r = await run(f, h.endpoint, "check.ts", ["--server", "alpha"]);
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stdout, /read only; nothing was changed/);
        assert.match(r.stdout, /broken\s+The server on the tailnet\s+this computer cannot find alpha on the tailnet/);
        assert.match(r.stdout, /ok\s+The Hetzner firewall "coolify"\s+the rules match the lane table: no inbound rules/);
        assert.ok(r.stdout.trimEnd().endsWith("(the saved block)"));
        assert.ok(log(f, "pulumi.log").every((l) => l.startsWith("stack output")), log(f, "pulumi.log").join("\n"));
        assert.ok(h.calls.every((c) => c.method === "GET"));
        assert.ok(existsSync(join(f.repo, "servers", "alpha.yaml")));
    } finally {
        h.server.close();
        rmSync(join(f.repo, ".."), { recursive: true, force: true });
    }
});

test("npm run launch --preflight names what is missing, then says ready, and creates nothing", { timeout: 60_000 }, async () => {
    const f = makeFolder();
    const h = await hetznerStandIn();
    try {
        // The folder's env file lacks TAILSCALE_AUTH_KEY, which a first launch needs.
        const missing = await run(f, h.endpoint, "launch.ts", ["--server", "alpha", "--preflight"]);
        assert.equal(missing.status, 1, missing.stdout);
        assert.match(missing.stdout, /TAILSCALE_AUTH_KEY/);
        assert.match(missing.stdout, /Not launched yet/);

        writeFileSync(
            join(f.repo, ".env.alpha"),
            `HCLOUD_TOKEN=${MARKER_TOKEN}\nPULUMI_CONFIG_PASSPHRASE=marker-passphrase\nTAILSCALE_AUTH_KEY=marker-auth-key\n`,
            { mode: 0o600 },
        );
        const ready = await run(f, h.endpoint, "launch.ts", ["--server", "alpha", "--preflight", "--json"]);
        assert.equal(ready.status, 0, ready.stdout);
        const last = JSON.parse(ready.stdout.trim().split("\n").pop()!);
        assert.equal(last.status, "ready");

        for (const out of [missing.stdout, ready.stdout]) {
            assert.ok(!out.includes(MARKER_TOKEN) && !out.includes("marker-passphrase") && !out.includes("marker-auth-key"), "a value was printed");
        }
        const pulumi = log(f, "pulumi.log").map((l) => l.split(" backend=")[0]);
        assert.deepEqual(pulumi, ["version", "version"], "the preflight asked pulumi for more than its version");
        assert.deepEqual(h.calls, [], "the preflight called Hetzner");

        const mixed = await run(f, h.endpoint, "launch.ts", ["--server", "alpha", "--preflight", "--resume"]);
        assert.equal(mixed.status, 2);
    } finally {
        h.server.close();
        rmSync(join(f.repo, ".."), { recursive: true, force: true });
    }
});
