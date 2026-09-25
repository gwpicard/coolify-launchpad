// Used by tests/offline-preview.sh. Takes the export of an empty stack and
// writes a state in which the server already exists, created with the
// user-data that the given auth key produces. A preview against that state
// shows what a later launch would do to a running server, without one.
//
//   tsx tests/lib/existing-server-state.ts <empty-export.json> <out.json> <server> <auth-key>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { buildUserData } from "../../program/cloud-init/build.js";

const [emptyPath, outPath, server, authKey] = process.argv.slice(2);
if (!emptyPath || !outPath || !server || !authKey) {
    throw new Error("usage: existing-server-state.ts <empty-export.json> <out.json> <server> <auth-key>");
}

const exported = JSON.parse(readFileSync(emptyPath, "utf8"));
const project = "coolify-launchpad";
const urn = (type: string, name: string) => `urn:pulumi:${server}::${project}::${type}::${name}`;
const stackUrn = urn("pulumi:pulumi:Stack", `${project}-${server}`);
const hcloudProvider = { urn: urn("pulumi:providers:hcloud", "default_1_42_0"), id: "00000000-0000-4000-8000-000000000001" };
const tlsProvider = { urn: urn("pulumi:providers:tls", "default_5_6_1"), id: "00000000-0000-4000-8000-000000000002" };
const ref = (p: { urn: string; id: string }) => `${p.urn}::${p.id}`;
const secret = (value: unknown) => ({
    "4dabf18193072939515e22adb298388d": "1b47061264138c4ac30d75fd1eb44270",
    plaintext: JSON.stringify(value),
});

const userData = buildUserData({ serverName: server, tailscaleAuthKey: authKey });
// The Hetzner provider stores user-data as the base64 of its SHA-1.
const userDataHash = createHash("sha1").update(userData).digest("base64");
// A throwaway key made here, because the TLS provider parses the stored PEM.
const pair = generateKeyPairSync("ed25519");
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const raw = pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
const sshString = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
const publicKey = `ssh-ed25519 ${Buffer.concat([sshString(Buffer.from("ssh-ed25519")), sshString(raw)]).toString("base64")}\n`;
const labels = { purpose: "coolify", server };
const firewallRules = [
    {
        description: "SSH until the tailnet is proved (removed in Phase B)",
        destinationIps: [],
        direction: "in",
        port: "22",
        protocol: "tcp",
        sourceIps: ["0.0.0.0/0", "::/0"],
    },
];

const serverInputs = {
    firewallIds: [1001],
    image: "ubuntu-24.04",
    labels,
    location: "nbg1",
    name: server,
    serverType: "cpx32",
    sshKeys: ["2001"],
    userData: secret(userData),
};

exported.deployment.resources = [
    { urn: stackUrn, custom: false, type: "pulumi:pulumi:Stack" },
    { urn: hcloudProvider.urn, custom: true, id: hcloudProvider.id, type: "pulumi:providers:hcloud", inputs: { version: "1.42.0" }, outputs: { version: "1.42.0" } },
    { urn: tlsProvider.urn, custom: true, id: tlsProvider.id, type: "pulumi:providers:tls", inputs: { version: "5.6.1" }, outputs: { version: "5.6.1" } },
    {
        urn: urn("tls:index/privateKey:PrivateKey", "coolify-ssh-key"), custom: true, id: "tls-key-marker",
        type: "tls:index/privateKey:PrivateKey", parent: stackUrn, provider: ref(tlsProvider),
        inputs: { algorithm: "ED25519", ecdsaCurve: "P224", rsaBits: 2048 },
        outputs: {
            id: "tls-key-marker", algorithm: "ED25519", ecdsaCurve: "P224", rsaBits: 2048,
            privateKeyOpenssh: secret("marker"), privateKeyPem: secret(privatePem), privateKeyPemPkcs8: secret(privatePem),
            publicKeyOpenssh: publicKey, publicKeyPem: publicPem, publicKeyFingerprintMd5: "marker", publicKeyFingerprintSha256: "marker",
        },
    },
    {
        urn: urn("hcloud:index/sshKey:SshKey", "coolify-ssh-key"), custom: true, id: "2001",
        type: "hcloud:index/sshKey:SshKey", parent: stackUrn, provider: ref(hcloudProvider),
        inputs: { labels, name: `coolify-launchpad-${server}`, publicKey },
        outputs: { id: "2001", fingerprint: "marker", labels, name: `coolify-launchpad-${server}`, publicKey },
    },
    {
        urn: urn("hcloud:index/firewall:Firewall", "coolify"), custom: true, id: "1001",
        type: "hcloud:index/firewall:Firewall", parent: stackUrn, provider: ref(hcloudProvider),
        inputs: { labels, name: "coolify", rules: firewallRules },
        outputs: { id: "1001", applyTos: [], labels, name: "coolify", rules: firewallRules },
    },
    {
        urn: urn("hcloud:index/server:Server", "coolify-server"), custom: true, id: "3001",
        type: "hcloud:index/server:Server", parent: stackUrn, provider: ref(hcloudProvider),
        inputs: serverInputs,
        outputs: {
            ...serverInputs,
            id: "3001", userData: userDataHash, status: "running",
            ipv4Address: "203.0.113.10", ipv6Address: "2001:db8::1", ipv6Network: "2001:db8::/64",
            datacenter: "nbg1-dc3", backups: false, keepDisk: false, rebuildProtection: false, deleteProtection: false,
            allowDeprecatedImages: false, shutdownBeforeDeletion: false, ignoreRemoteFirewallIds: false,
            publicNets: [], networks: [], primaryDiskSize: 160,
        },
        dependencies: [urn("hcloud:index/sshKey:SshKey", "coolify-ssh-key"), urn("hcloud:index/firewall:Firewall", "coolify")],
    },
];

writeFileSync(outPath, JSON.stringify(exported, null, 2));
