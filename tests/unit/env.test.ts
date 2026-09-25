// The env presence check: it names each secret that is not set, flags a file
// other users can read, and never puts a value into anything it returns or
// throws. The fixture values are made-up markers, not credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkEnvFile, requireEnvFile, secretsForChild, REQUIRED_SECRETS } from "../../lib/env.js";

const MARKERS = {
    HCLOUD_TOKEN: "marker-hcloud-value-0001",
    PULUMI_CONFIG_PASSPHRASE: "marker-passphrase-value-0002",
    TAILSCALE_AUTH_KEY: "marker-tailscale-value-0003",
};

function withEnvFile(body: string, mode: number, fn: (path: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "env-test-"));
    const path = join(dir, ".env.alpha");
    try {
        writeFileSync(path, body);
        chmodSync(path, mode);
        fn(path);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function assertNoValue(text: string): void {
    for (const v of Object.values(MARKERS)) assert.ok(!text.includes(v), `a value leaked: ${text}`);
}

test("the three secrets are the ones the design names", () => {
    assert.deepEqual([...REQUIRED_SECRETS], ["HCLOUD_TOKEN", "PULUMI_CONFIG_PASSPHRASE", "TAILSCALE_AUTH_KEY"]);
});

test("a complete file at mode 600 passes", () => {
    const body = Object.entries(MARKERS).map(([k, v]) => `${k}=${v}`).join("\n");
    withEnvFile(body, 0o600, (path) => {
        const r = checkEnvFile(path);
        assert.deepEqual(r, { missing: [], problems: [] });
        assert.doesNotThrow(() => requireEnvFile(path));
        assertNoValue(JSON.stringify(r));
    });
});

test("an empty value, a comment-only value and an absent key are each reported by name", () => {
    const body = [
        "# Copy to .env.<name>",
        `HCLOUD_TOKEN=${MARKERS.HCLOUD_TOKEN}`,
        "PULUMI_CONFIG_PASSPHRASE=            # encrypts the local Pulumi state",
        "",
    ].join("\n");
    withEnvFile(body, 0o600, (path) => {
        const r = checkEnvFile(path);
        assert.deepEqual(r.missing, ["PULUMI_CONFIG_PASSPHRASE", "TAILSCALE_AUTH_KEY"]);
        assertNoValue(JSON.stringify(r));
        assert.throws(
            () => requireEnvFile(path),
            (err: Error) => {
                assert.match(err.message, /Not set in \.env\.alpha: PULUMI_CONFIG_PASSPHRASE, TAILSCALE_AUTH_KEY/);
                assertNoValue(err.message);
                return true;
            },
        );
    });
});

test("an untouched copy of .env.example has nothing set, despite its trailing comments", () => {
    const example = readFileSync(fileURLToPath(new URL("../../.env.example", import.meta.url)), "utf8");
    withEnvFile(example, 0o600, (path) => assert.deepEqual(checkEnvFile(path).missing, [...REQUIRED_SECRETS]));
});

test("a file other users can read is flagged, and the message carries no value", () => {
    const body = Object.entries(MARKERS).map(([k, v]) => `${k}="${v}"`).join("\n");
    withEnvFile(body, 0o644, (path) => {
        const r = checkEnvFile(path);
        assert.equal(r.missing.length, 0);
        assert.match(r.problems[0], /chmod 600 \.env\.alpha/);
        assert.throws(() => requireEnvFile(path), (err: Error) => (assertNoValue(err.message), true));
    });
});

test("a missing file lists every key and says how to make one", () => {
    const r = checkEnvFile(join(tmpdir(), "no-such-folder-for-launchpad", ".env.alpha"));
    assert.deepEqual(r.missing, [...REQUIRED_SECRETS]);
    assert.match(r.problems[0], /Copy \.env\.example/);
});

test("the presence check prints nothing", () => {
    const body = `HCLOUD_TOKEN=${MARKERS.HCLOUD_TOKEN}\n`;
    const written: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((s: string) => (written.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => (written.push(String(s)), true)) as typeof process.stderr.write;
    try {
        withEnvFile(body, 0o600, (path) => {
            checkEnvFile(path);
            try { requireEnvFile(path); } catch { /* expected */ }
        });
    } finally {
        process.stdout.write = out;
        process.stderr.write = err;
    }
    assert.deepEqual(written, []);
});

test("values reach a child process's environment, unquoted, and nowhere else", () => {
    const body = Object.entries(MARKERS).map(([k, v]) => `${k}='${v}'`).join("\n");
    withEnvFile(body, 0o600, (path) => {
        assert.deepEqual(secretsForChild(path), MARKERS);
    });
});
