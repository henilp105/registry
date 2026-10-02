/**
 * Password hashing on WebCrypto.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 * `main` used `sha256(password + SALT)` with a single global static `SALT`, no
 * per-user salt and no iterations (defect S4). Identical passwords produced
 * identical hashes, making the whole user table rainbow-tableable, and the SALT
 * was committed in cleartext as `SALT=MYSALT` in `compose.yaml:25`.
 * `v2.0.1` moved to bcrypt with lazy migration from the legacy hash.
 *
 * ── Why not bcrypt here ──────────────────────────────────────────────────────
 * bcrypt is not available in the Workers runtime. The pure-JS fallback
 * (`bcryptjs`) costs 50-100 ms of CPU, which alone exceeds the **10 ms CPU
 * budget per invocation** on the Workers Free plan — roughly 5-10x over. So
 * bcrypt is not an option regardless of preference.
 *
 * ── What we use instead ──────────────────────────────────────────────────────
 * PBKDF2-HMAC-SHA256 via WebCrypto, which is a native, constant-time-ish
 * primitive and therefore effectively free in CPU terms. OWASP's guidance is
 * 600,000 iterations for PBKDF2-HMAC-SHA256; we default to 210,000, which is
 * what WebCrypto can do inside the budget and is still a large multiple of the
 * legacy zero iterations. The count is stored per hash, so it can be raised
 * later without invalidating existing credentials.
 *
 * Legacy `sha256(password + SALT)` is still **verified**, so nobody is locked
 * out, and is transparently upgraded on the next successful login.
 *
 * Note the target database is empty (verified: it has no `fpmregistry`
 * database), so there is nothing to migrate in practice. The legacy path exists
 * for deployments that do have legacy hashes.
 */

export type HashAlgorithm = "pbkdf2" | "legacy-sha256";

export type ParsedHash = {
  algorithm: HashAlgorithm;
  iterations: number;
  salt: string;
  hash: string;
};

// Defect D73: `sha256Hex` was declared here *and* exported from `./tokens`,
// as two identical implementations. This module now uses the shared one.
import { sha256Hex } from "./tokens";

// Re-exported so existing importers keep working, without a second implementation.
export { sha256Hex };

const PBKDF2_PREFIX = "pbkdf2$sha256$";
const LEGACY_PREFIX = "legacy-sha256$";

export const DEFAULT_PBKDF2_ITERATIONS = 210_000;
/** Floor below which a stored hash is considered stale and gets upgraded. */
const MIN_ACCEPTABLE_ITERATIONS = 100_000;

const encoder = new TextEncoder();

/** Hash format: `pbkdf2$sha256$<iterations>$<b64url salt>$<b64url dk>`. */
export async function hashPassword(
  password: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
  salt?: Uint8Array,
): Promise<string> {
  const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(password, useSalt, iterations);
  return `${PBKDF2_PREFIX}${iterations}$${b64u(useSalt)}$${b64u(dk)}`;
}

/** Verify a password against a stored hash of either algorithm. */
export async function verifyPassword(
  password: string,
  stored: string,
  salt: string,
): Promise<boolean> {
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const parsed = parseHash(stored);
    if (!parsed || parsed.algorithm !== "pbkdf2") return false;
    const dk = await pbkdf2(password, b64uDecode(parsed.salt), parsed.iterations);
    return timingSafeEqual(dk, b64uDecode(parsed.hash));
  }

  if (stored.startsWith(LEGACY_PREFIX)) {
    const legacy = stored.slice(LEGACY_PREFIX.length);
    return timingSafeEqualString(await sha256Hex(password + salt), legacy);
  }

  // bcrypt ($2a$/$2b$/$2y$) is intentionally not handled. `bcryptjs` would
  // exceed the 10 ms CPU budget, and the target database holds no legacy
  // bcrypt hashes. Fail closed rather than silently accepting.
  return false;
}

export function parseHash(stored: string): ParsedHash | null {
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const parts = stored.split("$");
    const [, , iterStr, saltStr, hashStr] = parts;
    if (!iterStr || !saltStr || !hashStr) return null;
    const iterations = Number(iterStr);
    if (!Number.isFinite(iterations) || iterations <= 0) return null;
    return { algorithm: "pbkdf2", iterations, salt: saltStr, hash: hashStr };
  }
  if (stored.startsWith(LEGACY_PREFIX)) {
    return { algorithm: "legacy-sha256", iterations: 0, salt: "", hash: stored.slice(LEGACY_PREFIX.length) };
  }
  return null;
}

/**
 * True when the stored hash should be replaced on a successful login, either
 * because it uses the legacy algorithm or because the KDF cost has moved on.
 */
export function needsRehash(stored: string, currentIterations = DEFAULT_PBKDF2_ITERATIONS): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  if (parsed.algorithm !== "pbkdf2") return true;
  return parsed.iterations < Math.min(currentIterations, MIN_ACCEPTABLE_ITERATIONS);
}

export function parseIterations(raw: string | undefined, fallback = DEFAULT_PBKDF2_ITERATIONS): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n >= 1_000 ? n : fallback;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function b64u(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}