/**
 * Random identifier and secret generation, plus SHA-256 as hex.
 *
 * `crypto.getRandomValues` is the only CSPRNG available in the Workers
 * runtime. `Math.random()` is explicitly not.
 */

/**
 * High-entropy opaque secret for verification links, password-reset links and
 * upload tokens. 256 bits, URL-safe.
 *
 * Only the SHA-256 of this value is persisted, so a database dump cannot be
 * replayed as a working credential — see the `auth_tokens` and `upload_tokens`
 * collections.
 */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Lowercase hex identifier, used for `users.uuid`. */
export function randomId(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function sha256Hex(value: string): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(value))
    .then((d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""));
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
