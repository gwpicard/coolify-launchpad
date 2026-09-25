import { step, skipped, type OnProgress } from "./progress.js";
import type { Remote, SshTarget } from "./ssh.js";
import { FIREWALL_NAME, type HetznerApi } from "./hetzner-firewall.js";

/**
 * /retire-server: destroy a server the launchpad made, after the person has
 * typed its name. It refuses anything it cannot show the launchpad created:
 * the stack must be this project's, hold only the launchpad's resource types,
 * and carry the launchpad's labels, and the live server and firewall must
 * match the stack.
 */

export const PROJECT = "coolify-launchpad";

/** Every resource type the program creates, plus the ones Pulumi adds itself. */
export const OUR_TYPES = new Set([
    "pulumi:pulumi:Stack",
    "pulumi:providers:hcloud",
    "pulumi:providers:tls",
    "tls:index/privateKey:PrivateKey",
    "hcloud:index/sshKey:SshKey",
    "hcloud:index/firewall:Firewall",
    "hcloud:index/server:Server",
]);

interface ExportedResource {
    urn?: string;
    type?: string;
    id?: string;
    outputs?: { name?: string; labels?: Record<string, string>; ipv4Address?: string };
}

export interface StackFacts {
    problems: string[];
    serverId?: number;
    firewallId?: number;
    publicIp?: string;
}

/** Read `pulumi stack export` and decide whether this stack is one the launchpad made for `name`. */
export function stackOwnership(exported: unknown, name: string): StackFacts {
    const resources = (exported as { deployment?: { resources?: ExportedResource[] } })?.deployment?.resources;
    if (!Array.isArray(resources)) return { problems: ["the stack export holds no resource list"] };
    const problems: string[] = [];
    const prefix = `urn:pulumi:${name}::${PROJECT}::`;
    for (const r of resources) {
        if (!r.urn?.startsWith(prefix)) problems.push(`the resource ${r.urn ?? "(no urn)"} is not in stack ${name} of project ${PROJECT}`);
        if (!r.type || !OUR_TYPES.has(r.type)) problems.push(`the stack holds a ${r.type ?? "untyped"} resource, which the launchpad never creates`);
    }
    const labelled = (r: ExportedResource) => r.outputs?.labels?.purpose === "coolify" && r.outputs?.labels?.server === name;
    const servers = resources.filter((r) => r.type === "hcloud:index/server:Server");
    const firewalls = resources.filter((r) => r.type === "hcloud:index/firewall:Firewall");
    const server = servers[0];
    const firewall = firewalls[0];
    if (servers.length > 1 || firewalls.length > 1) problems.push("the stack holds more than one server or firewall");
    if (server && (server.outputs?.name !== name || !labelled(server))) {
        problems.push(`the stack's server is not named ${name} with the labels purpose=coolify and server=${name}`);
    }
    if (firewall && (firewall.outputs?.name !== FIREWALL_NAME || !labelled(firewall))) {
        problems.push(`the stack's firewall is not named ${FIREWALL_NAME} with the labels purpose=coolify and server=${name}`);
    }
    return {
        problems,
        serverId: server?.id ? Number(server.id) : undefined,
        firewallId: firewall?.id ? Number(firewall.id) : undefined,
        publicIp: server?.outputs?.ipv4Address,
    };
}

export interface RetireDeps {
    stackExists(): boolean;
    stackExport(): unknown;
    hetzner: HetznerApi;
    tailnetIpOf(name: string): string | undefined;
    remote(target: SshTarget): Remote;
    /** Show the warning and return what the person typed. */
    confirm(warning: string): Promise<string>;
    destroy(): void;
    removeStack(): void;
    /** Remove servers/<name>.yaml and servers/<name>.block.txt; return what was removed. */
    removeRecords(): string[];
    /** Test hook: how long to wait for the node to leave the tailnet. */
    logoutWaitMs?: number;
}

export function retireWarning(name: string, publicIp?: string): string {
    return (
        `This destroys the server ${name}${publicIp ? ` (public IP ${publicIp})` : ""}, its disk with /data/coolify, ` +
        "and every tool Coolify hosts on it. It cannot be undone. Type the server name to go ahead."
    );
}

/** Logout drops the SSH session it runs in, so it runs detached, a moment after the session ends. */
export const LOGOUT_COMMAND =
    "setsid nohup sh -c 'sleep 2; tailscale logout' >/dev/null 2>&1 </dev/null & echo logout=scheduled";

export const CONSOLE_STEP =
    "In the Tailscale admin console, https://login.tailscale.com/admin/machines, find the machine, open its menu, " +
    "and choose Remove. Logging out expired its key; it did not delete the machine, and the launchpad holds no " +
    "credential that can.";

export interface RetireResult {
    removed: string[];
    stillYours: string[];
    loggedOut: boolean;
}

export async function retireServer(name: string, deps: RetireDeps, onProgress?: OnProgress): Promise<RetireResult> {
    const owned = await step(onProgress, `Checking that the launchpad made ${name}`, async () => {
        if (!deps.stackExists()) {
            throw new Error(
                `There is no Pulumi stack named ${name} in .pulumi/. Either the launchpad did not create this server, ` +
                "or it has already been retired. Nothing was changed.",
            );
        }
        const facts = stackOwnership(deps.stackExport(), name);
        const live = await deps.hetzner.serverByName(name);
        if (live) {
            if (live.labels?.purpose !== "coolify" || live.labels?.server !== name) {
                facts.problems.push(`the Hetzner server ${name} does not carry the labels purpose=coolify and server=${name}`);
            }
            if (facts.serverId !== undefined && live.id !== facts.serverId) {
                facts.problems.push(`the Hetzner server ${name} is ${live.id}, but the stack holds ${facts.serverId}`);
            }
        }
        const fw = await deps.hetzner.firewallByName(FIREWALL_NAME);
        if (fw && facts.firewallId !== undefined && fw.id === facts.firewallId && fw.labels?.server !== name) {
            facts.problems.push(`the firewall ${FIREWALL_NAME} is labelled for server ${fw.labels?.server ?? "(none)"}, not ${name}`);
        }
        if (facts.problems.length > 0) {
            throw new Error(`Refusing to retire ${name}: ${facts.problems.join("; ")}. Nothing was changed.`);
        }
        return { ...facts, live: Boolean(live) };
    }, (f) => (f.live ? `server ${f.serverId}` : "the stack is the launchpad's; the server is already gone from Hetzner"));

    const warning = retireWarning(name, owned.publicIp);
    const typed = await step(onProgress, "Waiting for the server name to be typed", () => deps.confirm(warning), undefined, warning);
    if (typed.trim() !== name) {
        throw new Error(`What was typed ("${typed.trim()}") is not ${name}. Nothing was destroyed.`);
    }

    let loggedOut = false;
    const tailnetIp = deps.tailnetIpOf(name);
    if (!tailnetIp) {
        skipped(onProgress, "Logging the node out of the tailnet", `this computer cannot find ${name} on the tailnet`);
    } else {
        loggedOut = await step(onProgress, "Logging the node out of the tailnet", async () => {
            const box = deps.remote({ host: tailnetIp, user: "root" });
            const sent = box.probe(LOGOUT_COMMAND, 30_000);
            if (!sent.ok) return false;
            const waitMs = deps.logoutWaitMs ?? 60_000;
            const deadline = Date.now() + waitMs;
            for (;;) {
                if (!box.probe("true", 10_000).ok) return true;
                if (Date.now() > deadline) return false;
                await new Promise((res) => setTimeout(res, Math.min(5_000, waitMs / 5)));
            }
        }, (ok) => (ok ? "the node no longer answers over the tailnet" : "logout sent, but the node still answered; the console step below covers it"));
    }

    await step(onProgress, `Destroying ${name} on Hetzner`, () => deps.destroy());
    await step(onProgress, `Removing the Pulumi stack ${name}`, () => deps.removeStack());
    const removed = await step(onProgress, "Removing the server's records", () => deps.removeRecords(), (r) => r.join(", ") || "none were left");
    return { removed, loggedOut, stillYours: [CONSOLE_STEP] };
}

export function renderRetired(name: string, r: RetireResult, envFile: string): string {
    return [
        `Retired ${name}, coolify-launchpad`,
        `Destroyed:   the server, its SSH key and the firewall "coolify" on Hetzner, and the Pulumi stack`,
        `Removed:     ${r.removed.join(", ") || "no record files were left"}`,
        `Kept:        ${envFile}, which holds your Hetzner token and passphrase; delete it when you no longer need them`,
        "",
        "Still yours to do",
        ...r.stillYours.map((s) => `- ${s}`),
    ].join("\n");
}
