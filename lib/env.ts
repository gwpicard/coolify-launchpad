import { readFileSync, existsSync, statSync } from "node:fs";
import { basename } from "node:path";

/**
 * The three secrets a launch needs, in `.env.<name>`. There is no
 * TAILNET_DNS_NAME: the tailnet suffix is read off the node in Phase B.
 */
export const REQUIRED_SECRETS = ["HCLOUD_TOKEN", "PULUMI_CONFIG_PASSPHRASE", "TAILSCALE_AUTH_KEY"] as const;
export type SecretName = (typeof REQUIRED_SECRETS)[number];

/**
 * Parse a dotenv-style file (`KEY=value`, one per line) without touching
 * process.env. Supports `KEY=value`, `KEY="quoted"`, `KEY='quoted'`, `#`
 * comments and a trailing `# comment` after an unquoted value. No `export`,
 * multi-line values or interpolation: these secrets are opaque strings.
 *
 * Private on purpose. Nothing outside this file sees a value except
 * `secretsForChild`, whose result goes straight into a child process's
 * environment.
 */
function readDotenv(path: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!existsSync(path)) return out;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith(`"`) && value.endsWith(`"`) && value.length >= 2) ||
            (value.startsWith(`'`) && value.endsWith(`'`) && value.length >= 2)) {
            value = value.slice(1, -1);
        } else if (value.startsWith("#")) {
            // `KEY=   # comment`, the shape .env.example uses for a key not yet filled in.
            value = "";
        } else {
            const hash = value.search(/\s#/);
            if (hash !== -1) value = value.slice(0, hash).trim();
        }
        out.set(key, value);
    }
    return out;
}

export interface EnvCheck {
    /** Key names that are absent or empty. Never a value. */
    missing: string[];
    /** Plain-language problems with the file itself, naming no value. */
    problems: string[];
}

/**
 * Check that each secret is set, and that the file is readable by its owner
 * only. The result names keys and never carries a value, so it is safe to
 * print, log, or hand to a skill.
 */
export function checkEnvFile(path: string, keys: readonly string[] = REQUIRED_SECRETS): EnvCheck {
    const name = basename(path);
    if (!existsSync(path)) {
        return { missing: [...keys], problems: [`${name} does not exist. Copy .env.example to it and fill it in.`] };
    }
    const problems: string[] = [];
    if (process.platform !== "win32") {
        const mode = statSync(path).mode & 0o777;
        if ((mode & 0o077) !== 0) {
            problems.push(`${name} can be read by other users of this computer. Run: chmod 600 ${name}`);
        }
    }
    const values = readDotenv(path);
    const missing = keys.filter((k) => (values.get(k) ?? "").trim() === "");
    return { missing, problems };
}

/**
 * Throw one error listing every missing key and file problem, by name only.
 * Used before anything is spent.
 */
export function requireEnvFile(path: string, keys: readonly string[] = REQUIRED_SECRETS): void {
    const { missing, problems } = checkEnvFile(path, keys);
    if (missing.length === 0 && problems.length === 0) return;
    const lines = [
        ...problems,
        ...(missing.length > 0 ? [`Not set in ${basename(path)}: ${missing.join(", ")}`] : []),
    ];
    throw new Error(lines.join("\n"));
}

/**
 * The secrets as an environment block for a child process (`pulumi`), which
 * reads them from its own environment. The caller passes the result to
 * `spawnSync` and does nothing else with it.
 */
export function secretsForChild(path: string, keys: readonly string[] = REQUIRED_SECRETS): Record<string, string> {
    requireEnvFile(path, keys);
    const values = readDotenv(path);
    const out: Record<string, string> = {};
    for (const k of keys) out[k] = values.get(k) as string;
    return out;
}
