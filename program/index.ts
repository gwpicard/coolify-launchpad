/**
 * The Pulumi program for one server. Pulumi runs this file at `pulumi up`
 * and `pulumi destroy`; the person never runs it directly. `npm run launch --
 * --server <name>` sets SERVER and the three secrets in the environment and
 * runs Pulumi with the stack named after the server.
 */
import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";
import * as tls from "@pulumi/tls";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../lib/spec.js";
import { buildUserData } from "./cloud-init/build.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const serverName = process.env.SERVER;
if (!serverName) {
    throw new Error("SERVER is not set. Run this through `npm run launch -- --server <name>`, not `pulumi up`.");
}
if (pulumi.getStack() !== serverName) {
    throw new Error(`The stack is ${pulumi.getStack()} but SERVER is ${serverName}. They must be the same.`);
}
const tailscaleAuthKey = process.env.TAILSCALE_AUTH_KEY;
if (!tailscaleAuthKey) {
    throw new Error("TAILSCALE_AUTH_KEY is not set. Run this through `npm run launch -- --server <name>`.");
}

const spec = loadSpec(serverName, repoRoot);

// Marked secret so the base64 auth key inside it is encrypted in the state
// file rather than stored in plain text.
const userData = pulumi.secret(buildUserData({ serverName: spec.name, tailscaleAuthKey }));

const sshKeyPair = new tls.PrivateKey("coolify-ssh-key", { algorithm: "ED25519" });

const sshKey = new hcloud.SshKey("coolify-ssh-key", {
    name: `coolify-launchpad-${spec.name}`,
    publicKey: sshKeyPair.publicKeyOpenssh,
    labels: { purpose: "coolify", server: spec.name },
});

// Named exactly `coolify`, which is coolify-devops's fixed host.firewall_name.
// At creation it lets in TCP 22 and nothing else. There are no outbound rules,
// which leaves all outbound traffic open. Phase B replaces the rules through
// the Hetzner API, and coolify-devops may own them after that, so Pulumi
// ignores later changes to them rather than putting 22 back on the next `up`.
const firewall = new hcloud.Firewall(
    "coolify",
    {
        name: "coolify",
        labels: { purpose: "coolify", server: spec.name },
        rules: [
            {
                direction: "in",
                protocol: "tcp",
                port: "22",
                sourceIps: ["0.0.0.0/0", "::/0"],
                description: "SSH until the tailnet is proved (removed in Phase B)",
            },
        ],
    },
    { ignoreChanges: ["rules"] },
);

const server = new hcloud.Server("coolify-server", {
    name: spec.name,
    serverType: spec.hetzner.type,
    location: spec.hetzner.location,
    image: "ubuntu-24.04",
    sshKeys: [sshKey.id],
    firewallIds: [firewall.id.apply((id) => Number(id))],
    userData,
    labels: { purpose: "coolify", server: spec.name },
});

export const ipv4Address = server.ipv4Address;
export const serverId = server.id;
export const firewallId = firewall.id;
export const privateKey = pulumi.secret(sshKeyPair.privateKeyOpenssh);
