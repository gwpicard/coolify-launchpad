// The server spec: the example stays valid, and a file whose name inside
// differs from its file name is refused, because the stack and the machine
// would then carry two names for one server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadSpec, parseSpec } from "../../lib/spec.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

const good = {
    name: "alpha",
    hetzner: { location: "nbg1", type: "cpx32" },
    public_lane: "none",
    dashboard: "github",
    install_tooling: true,
};

function withServers(files: Record<string, string>, fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "spec-test-"));
    try {
        mkdirSync(join(dir, "servers"));
        for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, "servers", name), body);
        fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test("servers/example.yaml is a valid spec", () => {
    const spec = loadSpec("example", root);
    assert.equal(spec.name, "example");
    assert.equal(spec.hetzner.type, "cpx32");
    assert.equal(spec.dashboard, "github");
});

test("a spec whose name differs from its file name is refused", () => {
    withServers({ "beta.yaml": "name: alpha\nhetzner: {location: nbg1, type: cpx32}\npublic_lane: none\ndashboard: github\ninstall_tooling: true\n" }, (dir) => {
        assert.throws(() => loadSpec("beta", dir), /must equal the file name/);
    });
    assert.throws(() => parseSpec(good, "beta"), /must equal the file name/);
});

test("a spec whose name equals its file name loads", () => {
    withServers({ "alpha.yaml": "name: alpha\nhetzner: {location: nbg1, type: cpx22}\npublic_lane: apps.example.com\ndashboard: tailnet\ninstall_tooling: false\n" }, (dir) => {
        const spec = loadSpec("alpha", dir);
        assert.equal(spec.public_lane, "apps.example.com");
        assert.equal(spec.hetzner.type, "cpx22");
    });
});

test("a name that is not one lowercase word is refused, before any path is built", () => {
    for (const bad of ["Alpha", "two words", "a-b", "../etc", "1abc", ""]) {
        assert.throws(() => loadSpec(bad, root), /not a server name/, bad);
        assert.throws(() => parseSpec({ ...good, name: bad }, bad), /not a valid server spec/, bad);
    }
});

test("a missing spec file says how to make one", () => {
    withServers({}, (dir) => assert.throws(() => loadSpec("gamma", dir), /Copy servers\/example.yaml/));
});

test("an unknown field, a bad lane and a bad exposure are refused", () => {
    assert.throws(() => parseSpec({ ...good, extra: 1 }, "alpha"), /not a valid server spec/);
    assert.throws(() => parseSpec({ ...good, public_lane: "Not A Domain" }, "alpha"), /public_lane/);
    assert.throws(() => parseSpec({ ...good, dashboard: "public" }, "alpha"), /dashboard/);
    assert.throws(() => parseSpec({ ...good, install_tooling: "yes" }, "alpha"), /install_tooling/);
});

test("location and type default to nbg1 and cpx32", () => {
    const spec = parseSpec({ ...good, hetzner: {} }, "alpha");
    assert.deepEqual(spec.hetzner, { location: "nbg1", type: "cpx32" });
});
