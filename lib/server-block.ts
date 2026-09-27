import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ServerSpec } from "./spec.js";

/**
 * The two blocks a launch ends with, in the formats docs/positioning.md owns:
 * the server block and its "Still yours to do" list when a launch finishes,
 * and "Not launched yet" when it stops.
 */

export const ENV_FILE = "/root/.config/coolify-devops.env";

export interface ServerBlockFacts {
    spec: ServerSpec;
    publicIp: string;
    tailnetIp: string;
    /** The node's MagicDNS name, for example alpha.tail1234.ts.net. */
    dnsName: string;
    /** What the env file points at: localhost:8000, or 127.0.0.1:8000 when localhost did not answer on the box. */
    coolifyUrl: string;
    /** Only in internet mode: the person typed that 2FA is on. */
    twoFactorConfirmed: boolean;
    /** How the admin account was known to exist. */
    adminCheck: "register-closed" | "confirmed-by-you";
    /** The env file's mode as read on the box, for example "600". */
    envMode: string;
    /** Whether COOLIFY_ACCESS_TOKEN is already set in the env file. Presence only. */
    envTokenSet: boolean;
    /** `node --version` on the box, when the tooling was installed. */
    nodeVersion?: string;
}

/**
 * The command that adds the token line to the env file. It asks for the token
 * without echoing it, so the token stays out of the shell history and the
 * command needs no edit. The line has the `export NAME=value` shape
 * envFileScript writes, with the value single-quoted because a Coolify token
 * has the form <id>|<secret>.
 */
export const TOKEN_LINE_COMMAND =
    `read -rsp 'Coolify token: ' T && ` +
    `printf "export COOLIFY_ACCESS_TOKEN='%s'\\n" "$T" >> ${ENV_FILE} && unset T; echo`;

/** Coolify's own steps for a GitHub App made by hand. */
export const COOLIFY_GITHUB_APP_DOCS = "https://coolify.io/docs/applications/sources/github/app";

/** Where GitHub delivers the App's webhooks, on the port the github rule opens. */
export function githubWebhookUrl(publicIp: string): string {
    return `http://${publicIp}:8000/webhooks/source/github/events`;
}

/**
 * GitHub's form for a new App, filled in from the block's own addresses. The
 * second real run made its App from a link with exactly these parameter names,
 * and every field landed. The webhook secret is left out on purpose: the person
 * types it, so it never sits in a link or a log.
 */
export function githubAppLink(name: string, coolifyUrl: string, publicIp: string): string {
    const e = encodeURIComponent;
    return (
        `https://github.com/settings/apps/new?name=${e(name)}&url=${e(coolifyUrl)}` +
        `&webhook_active=true&webhook_url=${e(githubWebhookUrl(publicIp))}&public=false` +
        `&contents=read&metadata=read&pull_requests=write&emails=read&events[]=push&events[]=pull_request`
    );
}

/** A DuckDNS name answers every name under it, so it needs no wildcard record. */
export function isDuckDns(suffix: string): boolean {
    return suffix === "duckdns.org" || suffix.endsWith(".duckdns.org");
}

const LABEL_WIDTH = 16;

function line(label: string, value: string): string {
    return `${`${label}:`.padEnd(LABEL_WIDTH, " ")}${value}`;
}

function continuation(value: string): string {
    return `${" ".repeat(LABEL_WIDTH)}${value}`;
}

export function renderServerBlock(f: ServerBlockFacts): string {
    const { spec } = f;
    const publicLane = spec.public_lane === "none" ? "none" : `${spec.public_lane} (80 and 443 open)`;
    const dashboard =
        spec.dashboard === "tailnet"
            ? "tailnet"
            : spec.dashboard === "github"
                ? "github (8000 open to GitHub's hook ranges)"
                : `internet (8000 open; 2FA ${f.twoFactorConfirmed ? "confirmed by you, not verified" : "NOT confirmed"})`;
    const nodeMajor = f.nodeVersion?.replace(/^v/, "").split(".")[0];
    const onTheBox = spec.install_tooling
        ? `Node ${nodeMajor ?? "22"}, git, jq, Claude Code, coolify-devops skills in /root`
        : "git, jq only";
    const envToken = f.envTokenSet ? "the token line is set" : "the token line is still to fill";
    return [
        "Launched by coolify-launchpad",
        line("Coolify", `${f.coolifyUrl} on the host   (from the tailnet: http://${f.tailnetIp}:8000)`),
        line("Server", `Hetzner ${spec.hetzner.type}, ${spec.hetzner.location}, Ubuntu 24.04, public IP ${f.publicIp}`),
        line(
            "Tailnet",
            `${f.dnsName}, tag:server, key expiry disabled, Tailscale SSH on and granted to root, proved from the operator's machine`,
        ),
        line("Public lane", publicLane),
        line("Dashboard", dashboard),
        line(
            "Admin",
            f.adminCheck === "register-closed"
                ? "created by you over the tailnet; Coolify's registration page closed after it"
                : "created by you over the tailnet, confirmed by you, not verified",
        ),
        line("Firewall", `Hetzner firewall "coolify", 22 closed; probe from the operator's machine matched the expectation table`),
        line("Env file", `${ENV_FILE}, mode ${f.envMode}, sourced by .bashrc; ${envToken}`),
        line("On the box", onTheBox),
        line("Next", "on the server, run /setup-coolify-devops; its step 1 interview confirms this block;"),
        continuation(
            f.envTokenSet
                ? "the token is already in the env file, so it goes on to its step 2"
                : "once the token is in the env file, a new session resumes at its step 2",
        ),
    ].join("\n");
}

/**
 * The console steps and commands the launchpad cannot do or verify. None is
 * marked done, because the launchpad did not perform it.
 */
export function stillYoursToDo(f: ServerBlockFacts): string[] {
    const { spec } = f;
    const items: string[] = [];
    if (!f.envTokenSet) {
        items.push(
            `Create the Coolify API token at http://${f.tailnetIp}:8000, Keys & Tokens, API tokens, with the read, write ` +
            `and deploy scopes and never root. The token never goes into a chat session. It goes into the env file this ` +
            `launch wrote, as a single-quoted line, because a Coolify token has the form <id>|<secret> and the | ` +
            `breaks an unquoted export. Append it. Do not run the cat > block that /setup-coolify-devops hands ` +
            `over, because it would overwrite the env file. A shell opened after the append loads the token. Open ` +
            `a shell on the server (not inside Claude Code), run this command and paste the token when asked: ` +
            TOKEN_LINE_COMMAND,
        );
    }
    const claudeNotes =
        " Claude Code there runs as root, the only user. claude -p refuses --permission-mode bypassPermissions " +
        "as root, so a headless run needs an allow-list (--allowedTools). A session signed in with your account " +
        "also loads that account's personal claude.ai connectors on the server.";
    if (spec.install_tooling) {
        items.push(`Sign in to Claude Code on the server: ssh root@${f.tailnetIp}, then claude.${claudeNotes}`);
    } else {
        items.push(
            `Install Node 22 on the server (coolify-devops needs Node 18 or newer), then Claude Code, then ` +
            `cd /root && npx -y skills add KasperHonore/coolify-devops -a claude-code -y.${claudeNotes}`,
        );
    }
    items.push(
        "In the tailnet policy, the autoApprovers.services entry and the Tailscale OAuth client for the registrar. " +
        "/setup-coolify-devops hands both over as its precondition 3, with the exact block and the console link.",
    );
    if (spec.public_lane !== "none") {
        items.push(
            isDuckDns(spec.public_lane)
                ? `The DuckDNS token, for coolify-devops's DuckDNS updater, which /setup-coolify-devops asks for as ` +
                  `its precondition 4. No wildcard record is needed: DuckDNS already answers every name under ` +
                  `${spec.public_lane}.`
                : `The DNS token and the wildcard record for *.${spec.public_lane}, which /setup-coolify-devops asks ` +
                  `for as its precondition 4.`,
        );
        items.push(
            `In Coolify at http://${f.tailnetIp}:8000, set the server's Wildcard Domain to ` +
            `https://${spec.public_lane}, under Servers, localhost, General. The public lane needs it, and ` +
            `coolify-devops's tools cannot write it, so it is done by hand.`,
        );
    }
    if (spec.dashboard !== "tailnet") {
        items.push(
            `After coolify-devops has accepted the server: the GitHub App, by Coolify's manual route. ` +
            `In Coolify at http://${f.tailnetIp}:8000, go to Sources, + Add, a name, ` +
            `Continue, then "Continue manually". Two real runs made the App this way over the tailnet, with no ` +
            `firewall change, and in the second a push reached Coolify through the App's webhook. Use it rather ` +
            `than "Register With GitHub", which sends the browser to ` +
            `http://${f.publicIp}:8000: plain HTTP, and not signed in if you use Coolify over the tailnet. ` +
            `Then open this link, which fills in GitHub's form for a new App at https://github.com/settings/apps/new: ` +
            `${githubAppLink(spec.name, `http://${f.tailnetIp}:8000`, f.publicIp)} ` +
            `It sets the name (change it if you like), the homepage URL (the Coolify URL, http://${f.tailnetIp}:8000), ` +
            `the webhook URL ${githubWebhookUrl(f.publicIp)}, the permissions contents read, metadata read, pull ` +
            `requests write and emails read, and the events push and pull_request. Type a long random webhook ` +
            `secret into the form yourself; the link leaves it out. Generate a client secret and a private key, and ` +
            `install the App on your repositories.`,
        );
        items.push(
            `Then finish the GitHub App in Coolify, as Coolify's own steps describe (${COOLIFY_GITHUB_APP_DOCS}). ` +
            `Add the private key under Keys & Tokens, Private Keys. In the source, fill in the App ID, the ` +
            `Installation ID (the number after /installations/ in the installation's URL), the Client ID, the ` +
            `client secret and the same webhook secret, and select the key.`,
        );
    }
    items.push(
        "Optional: for coolify-devops to manage the firewall from the server, create a separate Hetzner token " +
        "(read-only is enough to verify) and add it to the env file as HCLOUD_TOKEN. Never the launchpad's own token.",
    );
    return items;
}

export function renderHandOver(f: ServerBlockFacts): string {
    return [
        renderServerBlock(f),
        "",
        "Still yours to do",
        ...stillYoursToDo(f).map((s) => `- ${s}`),
    ].join("\n");
}

/** Where the block is written: servers/<name>.block.txt, which Git ignores. */
export function blockPath(name: string, repoRoot: string): string {
    return resolve(repoRoot, "servers", `${name}.block.txt`);
}

export function writeHandOver(name: string, repoRoot: string, text: string): string {
    const path = blockPath(name, repoRoot);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
    return path;
}

export interface Stopped {
    /** The last step that passed, or "nothing yet". */
    reached: string;
    /** One line, quoting the log or probe. */
    finding: string;
    /** The ways forward, joined with " | ". */
    then: string[];
}

/** The failure block from docs/positioning.md. */
export function renderStopped(s: Stopped): string {
    return [
        "Not launched yet, coolify-launchpad",
        `Reached:   ${s.reached}`,
        `Finding:   ${s.finding}`,
        `Then:      ${s.then.join(" | ")}`,
    ].join("\n");
}

/** The two ways forward once a server may exist. */
export function waysForward(name: string): string[] {
    return [`npm run launch -- --server ${name} --resume`, `/retire-server ${name}`];
}

/**
 * The failure block for an error thrown by a step. `reached` is the last step
 * that passed. Before anything was created the only way forward is to fix the
 * finding and launch again; after, it is to resume or to retire.
 */
export function stoppedFor(err: unknown, reached: string, name: string, serverMayExist: boolean): Stopped {
    const message = err instanceof Error ? err.message : String(err);
    return {
        reached,
        finding: message.split("\n")[0],
        then: serverMayExist ? waysForward(name) : [`fix the finding, then npm run launch -- --server ${name}`],
    };
}
