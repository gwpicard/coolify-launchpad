// Phase A's user-data: every placeholder resolves, there is no ubuntu user and
// no ufw, every fetch goes over IPv4, and the auth key only travels base64
// encoded. The key below is a made-up marker, not a credential.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserData, substitute, sectionsFor } from "../../program/cloud-init/build.js";
import { b64 } from "../../lib/secrets.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const KEY = "marker-ts-key-with-$-and-'-and-\"-0004";

// With the tooling, so every check below also covers the tooling section.
function script(extra: Partial<Parameters<typeof buildUserData>[0]> = {}): string {
    return buildUserData({ serverName: "alpha", tailscaleAuthKey: KEY, installTooling: true, ...extra });
}

test("every placeholder resolves", () => {
    const s = script();
    assert.ok(!/\{\{/.test(s) && !/\}\}/.test(s), "braces left in the script");
    assert.ok(s.includes("--hostname=alpha"));
    assert.ok(s.includes(b64(KEY)));
});

test("an unset placeholder fails, including one with a digit in its name", () => {
    assert.throws(() => substitute("x {{UNSET_1}} y", {}), /\{\{UNSET_1\}\}/);
    assert.equal(substitute("{{KEY_B64}}", { KEY_B64: "v" }), "v");
});

test("the assembled script has no ubuntu user and no ufw", () => {
    const s = script();
    assert.ok(!/ubuntu/i.test(s), "the script mentions ubuntu");
    assert.ok(!/useradd|adduser|sudoers/.test(s), "the script creates a user");
    assert.ok(!/\bufw\b/i.test(s), "the script mentions ufw");
});

test("the auth key only appears base64 encoded", () => {
    const s = script();
    assert.ok(!s.includes(KEY));
    assert.match(s, /base64 -d/);
});

test("the sections run in the designed order and the sentinel is last", () => {
    assert.deepEqual(sectionsFor(true), ["base.sh", "tailscale.sh", "coolify.sh", "tooling.sh", "sentinel.sh"]);
    assert.deepEqual(sectionsFor(false), ["base.sh", "tailscale.sh", "coolify.sh", "sentinel.sh"]);
    const s = script();
    const at = (needle: string) => s.indexOf(needle);
    assert.ok(s.startsWith("#!/bin/bash\n"));
    assert.ok(at("set -euo pipefail") < at("apt-get"));
    assert.ok(at("apt-get") < at("tailscale up"));
    assert.ok(at("tailscale up") < at("coolify/install.sh"));
    assert.ok(at("coolify/install.sh") < at("setup_22.x"), "the tooling runs before Coolify");
    assert.ok(at("setup_22.x") < at("@anthropic-ai/claude-code"));
    assert.ok(at("@anthropic-ai/claude-code") < at("phase-a-done"));
});

test("a failed tooling install is reported and does not stop the script", () => {
    // The tooling section runs for real under the script's own `set -euo
    // pipefail`, with a curl that fails, and the lines after it must still run.
    const dir = mkdtempSync(join(tmpdir(), "tooling-test-"));
    try {
        writeFileSync(join(dir, "curl"), "#!/bin/sh\nexit 7\n", { mode: 0o755 });
        const tooling = readFileSync(new URL("../../program/cloud-init/snippets/tooling.sh", import.meta.url), "utf8");
        const body = ["set -euo pipefail", tooling, "echo after-tooling", "false", "echo not-reached"].join("\n");
        const r = spawnSync("bash", ["-c", body], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
        assert.match(r.stdout, /did not install, exit 7/);
        assert.match(r.stdout, /after-tooling/);
        assert.ok(!r.stdout.includes("not-reached"), "set -e was not back on after the tooling section");
        assert.notEqual(r.status, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("every fetch goes over IPv4", () => {
    const s = script();
    const curls = s.split("\n").filter((l) => /^\s*curl\b/.test(l) || /\|\s*curl\b/.test(l));
    assert.ok(curls.length >= 2);
    for (const l of curls) assert.match(l, /curl -4 /, l);
    for (const l of s.split("\n").filter((l) => /^\s*apt-get\b/.test(l))) assert.match(l, /Acquire::ForceIPv4=true/, l);
    assert.match(s, /Acquire::ForceIPv4 "true";/);
});

test("tailscale up joins as tag:server with SSH on, and a failure stops the script", () => {
    const s = script();
    assert.match(s, /tailscale up --auth-key="file:\$TAILSCALE_KEY_FILE" --ssh \\\n\s+--advertise-tags=tag:server --hostname=alpha/);
    assert.ok(!/tailscale up[^\n]*\|\|/.test(s), "tailscale up has a fallback that hides its failure");
    assert.ok(!/WARNING/.test(s));
});

test("no admin account is pre-created in user-data", () => {
    assert.ok(!/ROOT_USER|ROOT_USERNAME|ROOT_USER_PASSWORD/.test(script()));
});

test("the installer takes the version as its positional argument when one is pinned", () => {
    assert.match(script({ coolifyVersion: "4.0.0-beta.400" }), /install\.sh \| bash -s 4\.0\.0-beta\.400\n/);
    assert.match(script(), /install\.sh \| bash -s \n/);
    assert.throws(() => script({ coolifyVersion: "1; rm -rf /" }), /does not look like a Coolify version/);
});

test("an empty auth key is refused", () => {
    assert.throws(() => script({ tailscaleAuthKey: "" }), /TAILSCALE_AUTH_KEY is empty/);
});

test("the script is the same for the same inputs, so an unchanged spec never replaces the machine", () => {
    assert.equal(script(), script());
});

test("the auth key reaches tailscale through a mode 600 file, never the command line, and the file is removed", () => {
    const s = script();
    assert.ok(!/--auth-?key="?\$TAILSCALE_KEY"?[\s\\]/.test(s), "the decoded key is passed as an argument");
    assert.ok(!/TAILSCALE_KEY="\$\(/.test(s), "the decoded key is held in a shell variable");
    assert.match(s, /\(umask 077 && printf '%s' '[A-Za-z0-9+\/=]+' \| base64 -d > "\$TAILSCALE_KEY_FILE"\)/);
    assert.match(s, /trap 'rm -f "\$TAILSCALE_KEY_FILE"' EXIT/);
    assert.ok(s.indexOf("trap 'rm -f") < s.indexOf("base64 -d"), "the cleanup is set before the file is written");
    assert.ok(s.lastIndexOf('rm -f "$TAILSCALE_KEY_FILE"') > s.indexOf("tailscale up"));
});

test("apt waits for the lock that first-boot upgrades hold, instead of failing", () => {
    const s = script();
    assert.match(s, /DPkg::Lock::Timeout "300";/);
    assert.ok(s.indexOf("DPkg::Lock::Timeout") < s.indexOf("apt-get"));
});

test("the tooling section is there only when the spec asks for it", () => {
    const withTooling = script();
    const without = script({ installTooling: false });
    assert.match(withTooling, /deb\.nodesource\.com\/setup_22\.x/);
    assert.match(withTooling, /apt-get -o Acquire::ForceIPv4=true install -y nodejs/);
    assert.match(withTooling, /npm install -g @anthropic-ai\/claude-code/);
    for (const needle of ["nodesource", "nodejs", "claude-code", "npm "]) {
        assert.ok(!without.includes(needle), `the script without tooling mentions ${needle}`);
    }
    // The skills install is Phase B's, where a failure can be run again.
    assert.ok(!/skills add/.test(withTooling));
    // Nothing is written into /root that coolify-devops's scaffolder refuses.
    assert.ok(!/AGENTS\.md|CLAUDE\.md|instance\.yaml|\/root\/docs|\/root\/stacks/.test(withTooling));
});

test("the launchpad's own Hetzner token never reaches user-data", () => {
    assert.ok(!/HCLOUD_TOKEN/.test(script()));
});
