import { readFileSync } from "node:fs";
import { b64 } from "../../lib/secrets.js";

/**
 * The Coolify version passed to the installer as its positional argument.
 *
 * Left unset until a real run has confirmed that the installer takes a
 * version this way (tests/rehearsal.md lists it). The first real run left it
 * unset and got 4.3.23. Unset, the installer installs its current release.
 * Set it to a version string such as the one that run observed, and every
 * later launch installs exactly that.
 */
export const COOLIFY_VERSION: string | undefined = undefined;

const snippetsDir = new URL("./snippets/", import.meta.url);

/**
 * The sections of Phase A, in the order they run. `tooling.sh` is there only
 * when the spec asks for the server-side tooling. That answer is fixed before
 * the server exists and never changes, which is what lets it sit in user-data.
 * It runs after Coolify and cannot stop the script, so a failed Node install
 * never costs the server its Coolify.
 */
export function sectionsFor(installTooling: boolean): string[] {
    return ["base.sh", "tailscale.sh", "coolify.sh", ...(installTooling ? ["tooling.sh"] : []), "sentinel.sh"];
}

function snippet(name: string): string {
    return readFileSync(new URL(name, snippetsDir), "utf8");
}

/**
 * Replace every `{{PLACEHOLDER}}` and fail on one that has no value. The class
 * includes digits, as in `TAILSCALE_KEY_B64`: a narrower class once skipped a
 * placeholder silently.
 */
export function substitute(text: string, vars: Record<string, string>): string {
    return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => {
        if (!Object.hasOwn(vars, key)) {
            throw new Error(`cloud-init template uses {{${key}}}, which has no value`);
        }
        return vars[key];
    });
}

export interface BuildUserDataArgs {
    serverName: string;
    tailscaleAuthKey: string;
    /** The spec's install_tooling answer: Node 22 and Claude Code on the box. */
    installTooling: boolean;
    coolifyVersion?: string;
}

/**
 * Assemble the Hetzner user-data script for Phase A, which runs once, as root,
 * on first boot.
 *
 * One rule governs what goes in here. User-data is part of the Hetzner
 * server's fingerprint: change it and Pulumi replaces the machine, and a
 * replaced machine has no /data/coolify. So only what is fixed for the life
 * of the server goes in: its name, its tailnet key, whether the tooling is
 * installed, and the Coolify installer.
 * Anything that could change later (the firewall lane, the env file, the
 * skills install) happens in Phase B over SSH, where it can be run again.
 */
export function buildUserData(args: BuildUserDataArgs): string {
    if (!args.tailscaleAuthKey) {
        throw new Error("TAILSCALE_AUTH_KEY is empty; the server could not join the tailnet");
    }
    const version = args.coolifyVersion ?? COOLIFY_VERSION;
    if (version !== undefined && !/^[0-9A-Za-z.+-]+$/.test(version)) {
        throw new Error(`"${version}" does not look like a Coolify version`);
    }
    const vars: Record<string, string> = {
        SERVER_NAME: args.serverName,
        TAILSCALE_KEY_B64: b64(args.tailscaleAuthKey),
        COOLIFY_VERSION_ARG: version ?? "",
    };
    const sections = ["#!/bin/bash", ...sectionsFor(args.installTooling).map((s) => substitute(snippet(s), vars))];
    const script = sections.join("\n\n");
    const leftover = script.match(/\{\{[^}]*\}\}/);
    if (leftover) {
        throw new Error(`cloud-init script still contains ${leftover[0]} after substitution`);
    }
    return script;
}
