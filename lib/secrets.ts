/**
 * Base64-encode a secret for injection into a cloud-init or shell template.
 *
 * Why: cloud-init bodies are joined into bash strings, and a stray `$`, `"`,
 * backtick or newline in a key would break shell parsing or leak into the
 * wrong context. Base64 keeps the secret a single safe word until `base64 -d`
 * decodes it inside the target shell.
 */
export function b64(secret: string): string {
    return Buffer.from(secret, "utf8").toString("base64");
}

/** The inverse of `b64`, for tests. */
export function b64Decode(encoded: string): string {
    return Buffer.from(encoded, "base64").toString("utf8");
}
