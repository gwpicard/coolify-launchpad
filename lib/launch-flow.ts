import { step, skipped, type OnProgress } from "./progress.js";
import type { ServerSpec } from "./spec.js";
import type { Remote, SshTarget } from "./ssh.js";
import {
    adminInstruction,
    checkNodeIdentity,
    REGISTER_PROBE,
    installSkills,
    readBox,
    toolingProblems,
    waitForAdmin,
    writeEnvFile,
    type CoolifyReady,
    type TailnetOnBox,
} from "./phase-b.js";
import {
    applyLaneFirewall,
    describeProbe,
    describeRules,
    expectedProbe,
    laneRules,
    probeAll,
    probeMismatches,
    type HetznerApi,
    type PortState,
    type ProbeResult,
} from "./hetzner-firewall.js";
import { renderHandOver, stillYoursToDo, type ServerBlockFacts } from "./server-block.js";

/**
 * Phase B from the first leg to the hand-over. The launch script calls this
 * with the real SSH, Hetzner and network calls. The unit tests call it with
 * stand-ins, which is how the whole order of steps is rehearsed offline.
 */
export interface PhaseBDeps {
    waitForPhaseA(leg: SshTarget): Promise<CoolifyReady>;
    verifyTailnet(leg: SshTarget, server: string): TailnetOnBox;
    proveSshGrant(tailnetIp: string): Promise<SshTarget>;
    remote(target: SshTarget): Remote;
    hetzner: HetznerApi;
    fetchGithubHooks(): Promise<string[]>;
    probePort(host: string, port: number): Promise<PortState>;
    httpStatus(url: string): Promise<number | undefined>;
    writeHandOver(server: string, text: string): string;
    /** Test hooks: how long the admin wait and the probe retry may take. */
    timing?: { adminTimeoutMs?: number; adminIntervalMs?: number; probeTimeoutMs?: number; probeIntervalMs?: number };
}

export interface PhaseBInput {
    spec: ServerSpec;
    publicIp: string;
    serverId: number;
    /** Leg one on a first launch; leg two on a resume that found the node. */
    firstLeg: SshTarget;
    /** The person said the admin account exists, because /register never closed. */
    adminCreated: boolean;
    /** Internet mode only: the person typed that 2FA is on. */
    twoFactorOn: boolean;
}

export interface PhaseBResult {
    text: string;
    facts: ServerBlockFacts;
    stillYours: string[];
    path: string;
    probe: ProbeResult;
}

export function twoFactorFinding(server: string): string {
    return (
        "In internet mode port 8000 opens to everyone, so two-factor authentication must be on first. " +
        "Turn it on in Coolify under Settings, General, then run: " +
        `npm run launch -- --server ${server} --resume --two-factor-on`
    );
}

export function registrationOpenFinding(server: string): string {
    return (
        "Coolify's /register page still answers 200. In internet mode port 8000 would then let anyone create an " +
        "account, so the launch will not open it. Turn off registration in Coolify's settings, then run: " +
        `npm run launch -- --server ${server} --resume --admin-created --two-factor-on`
    );
}

export type FirstLeg = { kind: "tailnet"; host: string } | { kind: "public" };

/**
 * Where Phase B starts. A first launch uses the public IP with the key, since
 * port 22 is open. A resume looks for the node on the tailnet first. When it
 * finds none, it falls back to the public IP only if port 22 still answers,
 * because once the lane firewall is on, the fallback would wait 20 minutes
 * for nothing.
 */
export async function chooseFirstLeg(
    resume: boolean,
    name: string,
    publicIp: string,
    look: { tailnetIpOf(name: string): string | undefined; probePort(host: string, port: number): Promise<PortState> },
): Promise<FirstLeg> {
    if (!resume) return { kind: "public" };
    const ip = look.tailnetIpOf(name);
    if (ip) return { kind: "tailnet", host: ip };
    if ((await look.probePort(publicIp, 22)) === "open") return { kind: "public" };
    throw new Error(
        `This computer cannot find ${name} on the tailnet, and port 22 on ${publicIp} is closed, so the lane ` +
        "firewall is already on and there is no other way in. Check that this computer is signed in to the tailnet " +
        `(tailscale status) and that the machine is still named ${name} in the Tailscale console, then resume again.`,
    );
}

export async function phaseB(input: PhaseBInput, deps: PhaseBDeps, onProgress?: OnProgress): Promise<PhaseBResult> {
    const { spec } = input;
    const t = deps.timing ?? {};

    const ready = await step(
        onProgress,
        "Waiting for cloud-init to finish and Coolify to answer (up to 20 minutes)",
        () => deps.waitForPhaseA(input.firstLeg),
        (r) => (r.localhostAnswers ? undefined : "localhost:8000 does not answer on the box; 127.0.0.1:8000 does"),
    );
    const coolifyUrl = ready.localhostAnswers ? "http://localhost:8000" : "http://127.0.0.1:8000";

    const tailnet = await step(
        onProgress,
        "Verifying the tailnet node",
        () => deps.verifyTailnet(input.firstLeg, spec.name),
        (r) => `${r.dnsName}, ${r.tailnetIp}`,
    );
    await step(
        onProgress,
        "Checking that the node is this Hetzner server",
        () => checkNodeIdentity(deps.remote(input.firstLeg), { name: spec.name, publicIp: input.publicIp, serverId: input.serverId }),
        (id) => `public IP ${id.publicIp}${id.instanceId ? `, server ${id.instanceId}` : ""}`,
    );
    const leg2 = await step(onProgress, "Proving the SSH grant from this computer", () => deps.proveSshGrant(tailnet.tailnetIp));
    const box = deps.remote(leg2);

    let adminCheck: ServerBlockFacts["adminCheck"] = "register-closed";
    if (input.adminCreated) {
        adminCheck = "confirmed-by-you";
        skipped(onProgress, "Waiting for the Coolify admin account", "you confirmed it exists");
    } else {
        await step(
            onProgress,
            "Waiting for the Coolify admin account",
            () => waitForAdmin(box, spec.name, { timeoutMs: t.adminTimeoutMs, intervalMs: t.adminIntervalMs }),
            (code) => `/register now answers ${code}`,
            adminInstruction(tailnet.tailnetIp),
        );
    }

    const env = await step(
        onProgress,
        "Writing /root/.config/coolify-devops.env",
        () => writeEnvFile(box, coolifyUrl),
        (r) => (r.written ? `written, mode ${r.mode}` : `already there, left untouched (mode ${r.mode})`),
    );

    if (spec.install_tooling) {
        await step(
            onProgress,
            "Installing the coolify-devops skills in /root",
            () => installSkills(box),
            (r) => (r === "kept" ? "already installed" : undefined),
        );
    } else {
        skipped(onProgress, "Installing the coolify-devops skills in /root", "the spec says no tooling");
    }
    const facts = await step(onProgress, "Checking /root and the tools on the box", () => {
        const f = readBox(box);
        const problems = toolingProblems(f, spec.install_tooling);
        if (problems.length > 0) throw new Error(problems.join("\n"));
        return f;
    }, (f) => (spec.install_tooling ? `Node ${f.nodeVersion}` : undefined));

    if (spec.dashboard === "internet" && adminCheck === "confirmed-by-you") {
        // --admin-created skipped the wait. In internet mode 8000 is about to
        // open to everyone, so an open registration page would hand the
        // server's next account to anybody. Look once more, and refuse.
        await step(onProgress, "Checking that Coolify's registration is closed", () => {
            const code = box.probe(REGISTER_PROBE, 30_000).stdout.trim();
            if (code === "200") throw new Error(registrationOpenFinding(spec.name));
            return code;
        }, (code) => `/register answers ${code || "nothing"}`);
    }
    if (spec.dashboard === "internet" && !input.twoFactorOn) {
        await step(onProgress, "Checking that two-factor authentication is on", () => {
            throw new Error(twoFactorFinding(spec.name));
        });
    }
    const hooks = spec.dashboard === "github"
        ? await step(onProgress, "Reading GitHub's webhook ranges", () => deps.fetchGithubHooks(), (h) => `${h.length} ranges`)
        : undefined;
    const rules = laneRules(spec, hooks);
    await step(
        onProgress,
        'Applying the lane firewall to "coolify" (22 closes)',
        () => applyLaneFirewall(deps.hetzner, spec.name, input.serverId, rules),
        () => describeRules(rules),
    );

    const expected = expectedProbe(spec);
    const probe = await step(
        onProgress,
        "Probing the public IP from this computer",
        () => probeUntilMatched(input.publicIp, expected, deps, t),
        (r) => describeProbe(r),
    );
    await step(onProgress, "Reaching Coolify over the tailnet from this computer", async () => {
        const status = await deps.httpStatus(`http://${tailnet.tailnetIp}:8000`);
        if (status === undefined) {
            throw new Error(`curl -sI http://${tailnet.tailnetIp}:8000 got no answer from this computer`);
        }
        return status;
    }, (s) => `HTTP ${s}`);

    const blockFacts: ServerBlockFacts = {
        spec,
        publicIp: input.publicIp,
        tailnetIp: tailnet.tailnetIp,
        dnsName: tailnet.dnsName,
        coolifyUrl,
        twoFactorConfirmed: input.twoFactorOn,
        adminCheck,
        envMode: env.mode,
        envTokenSet: facts.tokenSet,
        nodeVersion: spec.install_tooling ? facts.nodeVersion : undefined,
    };
    const text = renderHandOver(blockFacts);
    const path = await step(onProgress, `Writing servers/${spec.name}.block.txt`, () => deps.writeHandOver(spec.name, text));
    return { text, facts: blockFacts, stillYours: stillYoursToDo(blockFacts), path, probe };
}

/**
 * A firewall change takes a moment to reach the edge, so a mismatch is read
 * again for a minute before it counts.
 */
async function probeUntilMatched(
    host: string,
    expected: ProbeResult,
    deps: PhaseBDeps,
    t: NonNullable<PhaseBDeps["timing"]>,
): Promise<ProbeResult> {
    let last: ProbeResult | undefined;
    try {
        return await pollUntilAsync(
            async () => {
                last = await probeAll(host, deps.probePort);
                const mismatches = probeMismatches(last, expected);
                return mismatches.length === 0 ? { done: true, value: last } : { done: false, last: mismatches.join("; ") };
            },
            t.probeTimeoutMs ?? 60_000,
            t.probeIntervalMs ?? 10_000,
        );
    } catch {
        const mismatches = last ? probeMismatches(last, expected) : ["no probe result"];
        throw new Error(
            `The probe from this computer does not match the expectation table: ${mismatches.join("; ")}. ` +
            "docs/server-model.md has the table.",
        );
    }
}

async function pollUntilAsync<T>(
    attempt: () => Promise<{ done: true; value: T } | { done: false; last: string }>,
    timeoutMs: number,
    intervalMs: number,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const r = await attempt();
        if (r.done) return r.value;
        if (Date.now() + intervalMs > deadline) throw new Error(r.last);
        await new Promise((res) => setTimeout(res, intervalMs));
    }
}
