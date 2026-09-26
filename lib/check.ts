import type { ServerSpec } from "./spec.js";
import type { Remote, SshTarget } from "./ssh.js";
import { checkTailnet } from "./tailnet.js";
import { CHECK_RULE_FINDING, GRANT_ATTEMPT_TIMEOUT_MS, identityProblems, NODE_IDENTITY_PROBE, nodeMajor, readBox, readNodeIdentity } from "./phase-b.js";
import {
    describeProbe,
    describeRules,
    expectedProbe,
    FIREWALL_NAME,
    laneRules,
    ownershipProblems,
    probeAll,
    probeMismatches,
    sameRules,
    type HetznerApi,
    type PortState,
} from "./hetzner-firewall.js";

/**
 * /check-server: read a launched server back without changing anything. Every
 * call here reads. The firewall is read through the Hetzner API with GET
 * requests only, the box through SSH commands that print and write nothing.
 */

export type CheckStatus = "broken" | "to do" | "not checked" | "ok";

export interface CheckRow {
    status: CheckStatus;
    what: string;
    detail: string;
}

export interface CheckDeps {
    /** The public IP and server id from the local Pulumi stack. Throws when there is no stack. */
    stack(): { publicIp: string; serverId: number };
    tailnetIpOf(name: string): string | undefined;
    remote(target: SshTarget): Remote;
    hetzner: HetznerApi;
    fetchGithubHooks(): Promise<string[]>;
    probePort(host: string, port: number): Promise<PortState>;
    httpStatus(url: string): Promise<number | undefined>;
    /** servers/<name>.block.txt, or undefined when there is none. */
    readBlock(name: string): string | undefined;
}

export interface CheckReport {
    rows: CheckRow[];
    block?: string;
    broken: number;
}

const ORDER: CheckStatus[] = ["broken", "to do", "not checked", "ok"];

function firstLine(err: unknown): string {
    return (err instanceof Error ? err.message : String(err)).split("\n")[0];
}

export async function checkServer(spec: ServerSpec, deps: CheckDeps): Promise<CheckReport> {
    const rows: CheckRow[] = [];
    const add = (status: CheckStatus, what: string, detail: string) => rows.push({ status, what, detail });

    let stack: { publicIp: string; serverId: number } | undefined;
    try {
        stack = deps.stack();
        add("ok", "The local Pulumi stack", `server ${stack.serverId}, public IP ${stack.publicIp}`);
    } catch (err) {
        add("broken", "The local Pulumi stack", firstLine(err));
    }

    // The live rules, read back through the API.
    if (stack) {
        try {
            const fw = await deps.hetzner.firewallByName(FIREWALL_NAME);
            if (!fw) {
                add("broken", 'The Hetzner firewall "coolify"', "there is no firewall of that name in the Hetzner project");
            } else {
                const owner = ownershipProblems(fw, spec.name, stack.serverId);
                const hooks = spec.dashboard === "github" ? await deps.fetchGithubHooks() : undefined;
                const expected = laneRules(spec, hooks);
                if (owner.length > 0) add("broken", 'The Hetzner firewall "coolify"', owner.join("; "));
                else if (!sameRules(fw.rules, expected)) {
                    add(
                        "broken",
                        'The Hetzner firewall "coolify"',
                        `the rules differ from the lane table. Live: ${describeRules(fw.rules)}. Expected: ${describeRules(expected)}.`,
                    );
                } else add("ok", 'The Hetzner firewall "coolify"', `the rules match the lane table: ${describeRules(expected)}`);
            }
        } catch (err) {
            add("broken", 'The Hetzner firewall "coolify"', `could not be read: ${firstLine(err)}`);
        }

        const probe = await probeAll(stack.publicIp, deps.probePort);
        const mismatches = probeMismatches(probe, expectedProbe(spec));
        if (mismatches.length > 0) add("broken", "The probe from this computer", `${mismatches.join("; ")}`);
        else add("ok", "The probe from this computer", `${describeProbe(probe)}, as the expectation table says`);
    } else {
        add("not checked", 'The Hetzner firewall "coolify" and the probe', "there is no stack to read the server from");
    }

    const tailnetIp = deps.tailnetIpOf(spec.name);
    if (!tailnetIp) {
        add("broken", "The server on the tailnet", `this computer cannot find ${spec.name} on the tailnet`);
        add("not checked", "The node, Coolify, the env file and the tools", "they are read over the tailnet");
        return finish(rows, deps.readBlock(spec.name));
    }
    add("ok", "The server on the tailnet", `${spec.name} is at ${tailnetIp}`);

    const box = deps.remote({ host: tailnetIp, user: "root" });
    const grant = box.probe("true", GRANT_ATTEMPT_TIMEOUT_MS);
    if (!grant.ok) {
        add(
            "broken",
            "Tailscale SSH from this computer",
            grant.timedOut ? CHECK_RULE_FINDING : (grant.stderr.trim().split("\n").pop() || `exit ${grant.status}`),
        );
        add("not checked", "The node, the env file and the tools", "they are read over Tailscale SSH");
        return finish(rows, deps.readBlock(spec.name));
    }
    add("ok", "Tailscale SSH from this computer", `root@${tailnetIp} with no key`);

    // The machine was found by name. Nothing more is read from it until it
    // has shown it is the stack's server, not a stale one of the same name.
    const identityWhat = "The tailnet machine is this server";
    if (!stack) {
        add("not checked", identityWhat, "there is no stack to compare it with");
        add("not checked", "Coolify, the node, the env file and the tools", "the machine could not be matched to the stack");
        return finish(rows, deps.readBlock(spec.name));
    }
    const identity = readNodeIdentity(box.probe(NODE_IDENTITY_PROBE, 60_000).stdout);
    const mismatch = identityProblems(identity, { name: spec.name, publicIp: stack.publicIp, serverId: stack.serverId });
    if (mismatch.length > 0) {
        for (const p of mismatch) add("broken", identityWhat, p);
        add("not checked", "Coolify, the node, the env file and the tools", "the machine is not this server");
        return finish(rows, deps.readBlock(spec.name));
    }
    add("ok", identityWhat, `public IP ${identity.publicIp}${identity.instanceId ? `, server ${identity.instanceId}` : ""}`);

    const status = await deps.httpStatus(`http://${tailnetIp}:8000`);
    if (status === undefined) add("broken", "Coolify over the tailnet", `http://${tailnetIp}:8000 gave no answer`);
    else add("ok", "Coolify over the tailnet", `http://${tailnetIp}:8000 answers HTTP ${status}`);

    try {
        const node = checkTailnet(box.run("tailscale status --json"), box.run("tailscale debug prefs"), spec.name);
        if (node.facts) add("ok", "The tailnet node", `${node.facts.dnsName}, tag:server, key expiry disabled, Tailscale SSH on`);
        for (const p of node.problems) add("broken", "The tailnet node", p);
    } catch (err) {
        add("broken", "The tailnet node", firstLine(err));
    }

    let facts;
    try {
        facts = readBox(box);
    } catch (err) {
        add("broken", "The env file and the tools", `could not be read: ${firstLine(err)}`);
        return finish(rows, deps.readBlock(spec.name));
    }
    const envWhat = "/root/.config/coolify-devops.env";
    if (!facts.envFile) add("broken", envWhat, "the file is missing");
    else if (facts.envMode !== "600") add("broken", envWhat, `mode ${facts.envMode}, not 600: chmod 600 it on the server`);
    else if (!facts.bashrcSources) add("broken", envWhat, "/root/.bashrc does not source it");
    else add("ok", envWhat, "present, mode 600, sourced by .bashrc");
    if (facts.envFile) {
        if (facts.tokenSet) add("ok", "COOLIFY_ACCESS_TOKEN", "set (checked for presence only)");
        else add("to do", "COOLIFY_ACCESS_TOKEN", "not set yet: create it in Coolify and add it on the server with the command the server block gives");
    }
    if (!facts.coolifyAnswers) add("broken", "Coolify on the box", "http://127.0.0.1:8000 does not answer on the server");

    const tooling = spec.install_tooling;
    const missing = (status: CheckStatus, what: string, detail: string) => add(tooling ? "broken" : status, what, detail);
    add(facts.git && facts.jq ? "ok" : "broken", "git and jq", facts.git && facts.jq ? "present" : "missing on the box");
    if (nodeMajor(facts.nodeVersion) >= 18) add("ok", "Node", facts.nodeVersion);
    else missing("to do", "Node", `${facts.nodeVersion || "absent"}; coolify-devops needs 18 or newer`);
    if (facts.claude) add("ok", "Claude Code", "present");
    else missing("to do", "Claude Code", "not on the box");
    if (facts.skillsLock) add("ok", "The coolify-devops skills", "installed in /root");
    else missing("to do", "The coolify-devops skills", "not installed in /root");

    return finish(rows, deps.readBlock(spec.name));
}

function finish(rows: CheckRow[], block: string | undefined): CheckReport {
    const sorted = [...rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
    return { rows: sorted, block, broken: rows.filter((r) => r.status === "broken").length };
}

/** One table, the broken things first, then the saved server block again. */
export function renderCheck(name: string, report: CheckReport): string {
    const statusWidth = Math.max(...report.rows.map((r) => r.status.length), "Status".length);
    const whatWidth = Math.max(...report.rows.map((r) => r.what.length), "Check".length);
    const row = (s: string, w: string, d: string) => `${s.padEnd(statusWidth)}  ${w.padEnd(whatWidth)}  ${d}`;
    const lines = [
        `Check of ${name}, coolify-launchpad (read only; nothing was changed)`,
        "",
        row("Status", "Check", "Detail"),
        row("-".repeat(statusWidth), "-".repeat(whatWidth), "------"),
        ...report.rows.map((r) => row(r.status, r.what, r.detail)),
        "",
        report.block ?? `There is no servers/${name}.block.txt, so there is no server block to show again.`,
    ];
    return lines.join("\n");
}
