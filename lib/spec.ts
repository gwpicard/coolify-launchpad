import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { z } from "zod";

/**
 * One lowercase word of letters and digits. It becomes the Hetzner server name,
 * the Tailscale hostname, the Pulumi stack name and the spec filename, so it
 * has to be valid in all four and safe to put in a path.
 */
export const serverNamePattern = /^[a-z][a-z0-9]{0,62}$/;

/** A domain the team owns, or a DuckDNS one. Lowercase, at least two labels. */
const domainPattern = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const dashboardExposures = ["tailnet", "github", "internet"] as const;

export const serverSpecSchema = z
    .object({
        name: z.string().regex(serverNamePattern, "name must be one lowercase word of letters and digits, starting with a letter"),
        hetzner: z
            .object({
                location: z.string().min(1).default("nbg1"),
                type: z.string().min(1).default("cpx32"),
            })
            .strict(),
        public_lane: z.union([
            z.literal("none"),
            z.string().regex(domainPattern, "public_lane must be none, or a lowercase domain such as apps.example.com"),
        ]),
        dashboard: z.enum(dashboardExposures),
        install_tooling: z.boolean(),
    })
    .strict();

export type ServerSpec = z.infer<typeof serverSpecSchema>;

/** Where a server's spec lives: servers/<name>.yaml under the repository root. */
export function specPath(name: string, repoRoot: string): string {
    return resolve(repoRoot, "servers", `${name}.yaml`);
}

/** Where a server's secrets live: .env.<name> under the repository root. */
export function envPath(name: string, repoRoot: string): string {
    return resolve(repoRoot, `.env.${name}`);
}

/**
 * Validate parsed YAML against the schema, and require the name inside the
 * file to equal the name the file was opened by. Two names for one server
 * would give the Pulumi stack one name and the Hetzner machine another.
 */
export function parseSpec(raw: unknown, fileName: string): ServerSpec {
    const result = serverSpecSchema.safeParse(raw);
    if (!result.success) {
        const messages = result.error.issues
            .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n");
        throw new Error(`servers/${fileName}.yaml is not a valid server spec:\n${messages}`);
    }
    if (result.data.name !== fileName) {
        throw new Error(
            `servers/${fileName}.yaml says name: ${result.data.name}. ` +
            `The name inside the file must equal the file name. Rename one or the other.`,
        );
    }
    return result.data;
}

/** Load servers/<name>.yaml and validate it. Throws a readable error. */
export function loadSpec(name: string, repoRoot: string): ServerSpec {
    if (!serverNamePattern.test(name)) {
        throw new Error(`"${name}" is not a server name. Use one lowercase word of letters and digits.`);
    }
    const path = specPath(name, repoRoot);
    if (!existsSync(path)) {
        throw new Error(`No spec at servers/${name}.yaml. Copy servers/example.yaml to it and fill it in.`);
    }
    return parseSpec(yamlLoad(readFileSync(path, "utf8")), name);
}
