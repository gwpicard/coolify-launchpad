/**
 * Reads what the node reports about itself and decides whether it is on the
 * tailnet the way coolify-devops expects: signed in, tagged `tag:server`, key
 * expiry disabled, MagicDNS and HTTPS on, Tailscale SSH on.
 *
 * Kept free of SSH so it can be tested against saved JSON. Phase B step 2
 * fetches `tailscale status --json` and `tailscale debug prefs` over SSH and
 * passes the text here.
 */

export interface TailnetFacts {
    /** The tailnet's DNS suffix, for example tail1234.ts.net. */
    suffix: string;
    /** The node's full MagicDNS name without the trailing dot. */
    dnsName: string;
}

export interface TailnetCheck {
    problems: string[];
    facts?: TailnetFacts;
}

const MAGIC_DNS_CONSOLE = "https://login.tailscale.com/admin/dns";

interface StatusJson {
    BackendState?: string;
    MagicDNSSuffix?: string;
    CertDomains?: string[] | null;
    CurrentTailnet?: { MagicDNSEnabled?: boolean } | null;
    Self?: {
        HostName?: string;
        DNSName?: string;
        Tags?: string[] | null;
        KeyExpiry?: string | null;
    };
}

function parse<T>(text: string, what: string): T {
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`${what} did not return JSON: ${text.trim().slice(0, 80)}`);
    }
}

export function checkTailnet(statusText: string, prefsText: string, serverName: string): TailnetCheck {
    const status = parse<StatusJson>(statusText, "tailscale status --json");
    const prefs = parse<{ RunSSH?: boolean }>(prefsText, "tailscale debug prefs");
    const problems: string[] = [];
    const self = status.Self ?? {};

    if (status.BackendState !== "Running") {
        problems.push(`Tailscale on the server is not signed in (state ${status.BackendState ?? "unknown"}).`);
    }
    if (!(self.Tags ?? []).includes("tag:server")) {
        problems.push("The node is not tagged tag:server. The auth key must be created for tag:server.");
    }
    // A tagged node has no key expiry, and the JSON then carries null or
    // leaves the field out. Either reads as null to jq, which is what
    // coolify-devops checks.
    if (self.KeyExpiry !== undefined && self.KeyExpiry !== null) {
        problems.push(`The node's key expires at ${self.KeyExpiry}. A key created for tag:server should bring the node up with expiry disabled.`);
    }
    if (prefs.RunSSH !== true) {
        problems.push("Tailscale SSH is off on the node. cloud-init runs tailscale up with --ssh, so this means that step did not run as written.");
    }
    const suffix = (status.MagicDNSSuffix ?? "").trim();
    const magicDnsOff = status.CurrentTailnet?.MagicDNSEnabled === false;
    if (!suffix || magicDnsOff) {
        problems.push(`MagicDNS is off on the tailnet. Turn it on at ${MAGIC_DNS_CONSOLE}, then run the launch again.`);
    }
    if ((status.CertDomains ?? []).length === 0) {
        problems.push(`HTTPS certificates are off on the tailnet. Turn them on at ${MAGIC_DNS_CONSOLE}, then run the launch again.`);
    }

    const dnsName = (self.DNSName ?? "").replace(/\.$/, "");
    const firstLabel = dnsName.split(".")[0];
    if (dnsName && firstLabel !== serverName) {
        problems.push(
            `The node joined as ${firstLabel}, not ${serverName}. An older machine named ${serverName} is probably still ` +
            `in the tailnet. In the Tailscale console, under Machines, remove the old one and rename this one to ` +
            `${serverName}, then run the launch again.`,
        );
    }

    if (problems.length > 0) return { problems };
    return { problems, facts: { suffix, dnsName: dnsName || `${serverName}.${suffix}` } };
}
