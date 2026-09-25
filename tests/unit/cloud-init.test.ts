// Phase A's user-data: every placeholder resolves, there is no ubuntu user and
// no ufw, every fetch goes over IPv4, and the auth key only travels base64
// encoded. The key below is a made-up marker, not a credential.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserData, substitute, SECTIONS } from "../../program/cloud-init/build.js";
import { b64 } from "../../lib/secrets.js";

const KEY = "marker-ts-key-with-$-and-'-and-\"-0004";

function script(extra: Partial<Parameters<typeof buildUserData>[0]> = {}): string {
    return buildUserData({ serverName: "alpha", tailscaleAuthKey: KEY, ...extra });
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
    assert.deepEqual([...SECTIONS], ["base.sh", "tailscale.sh", "coolify.sh", "sentinel.sh"]);
    const s = script();
    const at = (needle: string) => s.indexOf(needle);
    assert.ok(s.startsWith("#!/bin/bash\n"));
    assert.ok(at("set -euo pipefail") < at("apt-get"));
    assert.ok(at("apt-get") < at("tailscale up"));
    assert.ok(at("tailscale up") < at("coolify/install.sh"));
    assert.ok(at("coolify/install.sh") < at("phase-a-done"));
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
    assert.match(s, /tailscale up --authkey="\$TAILSCALE_KEY" --ssh \\\n\s+--advertise-tags=tag:server --hostname=alpha/);
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
