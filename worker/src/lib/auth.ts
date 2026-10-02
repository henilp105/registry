/**
 * Authentication: JWT (HS256) and password hashing, both on WebCrypto.
 *
 * ── Why WebCrypto and not a library ──────────────────────────────────────────
 * `jsonwebtoken` / `jose` would each add tens of KiB and burn CPU we do not
 * have inside a 10 ms budget. HS256 is HMAC-SHA256 over a JSON payload, so
 * `crypto.subtle` is sufficient and costs almost nothing.
 *
 * ── Token compatibility ─────────────────────────────────────────────────────
 * The legacy app issues tokens with `flask-jwt-extended`: HS256, identity in
 * `sub`, plus `type: "access" | "refresh"`, `fresh`, `iat`, `exp`, `nbf`,
 * `jti`. We reproduce that claim set exactly, so tokens minted by the old
 * deployment keep working during the canary (Phase 10) and vice versa.
 */

import type { Env } from "../db/client";

export type TokenType = "access" | "refresh";

export type Claims = {
  sub: string;
  type: TokenType;
  fresh?: boolean;
  iat: number;
  exp: number;
  nbf: number;
  jti: string;
  [k: string]: unknown;
};

export type AuthContext = {
  /** The user's uuid — matches `flask-jwt-extended`'s `sub`. */
  uuid: string;
  token: string;
  claims: Claims;
};

export type UserDoc = {
  _id: unknown;
  uuid: string;
  username: string;
  email: string;
  password: string;
  isVerified: boolean;
  roles: string[];
  [k: string]: unknown;
};

const encoder = new TextEncoder();

// ── base64url ─────────────────────────────────────────────────────────────────

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── JWT ───────────────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export type SignOptions = {
  /** Days until expiry. The legacy app used 90 for access, 180 for refresh. */
  expiresInDays?: number;
  fresh?: boolean;
};

export async function signToken(
  uuid: string,
  secret: string,
  type: TokenType,
  opts: SignOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttlDays = opts.expiresInDays ?? (type === "access" ? 90 : 180);
  const claims: Claims = {
    sub: uuid,
    type,
    fresh: opts.fresh ?? false,
    iat: now,
    exp: now + ttlDays * 86_400,
    nbf: now,
    jti: crypto.randomUUID(),
  };

  const header = b64urlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64urlEncode(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;

  const key = await importHmacKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${b64urlEncode(mac)}`;
}

export type VerifyFailure =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "not-yet-valid"
  | "wrong-type"
  | "missing-sub";

export type VerifyResult = { ok: true; claims: Claims } | { ok: false; reason: VerifyFailure };

/**
 * Verify a token. Constant-time signature check via `crypto.subtle.verify`.
 */
export async function verifyToken(token: string, secret: string, expect?: TokenType): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [header, payload, signature] = parts as [string, string, string];

  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(signature) as unknown as ArrayBuffer,
      encoder.encode(`${header}.${payload}`) as unknown as ArrayBuffer,
    );
    if (!valid) return { ok: false, reason: "bad-signature" };
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let claims: Claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as Claims;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) return { ok: false, reason: "not-yet-valid" };
  if (expect && claims.type !== expect) return { ok: false, reason: "wrong-type" };
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return { ok: false, reason: "missing-sub" };

  return { ok: true, claims };
}

/**
 * Resolve the caller from the `Authorization: Bearer` header.
 *
 * Returns `null` rather than throwing so anonymous routes stay reachable and
 * the individual handler decides how to respond.
 */
export async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const result = await verifyToken(token, env.JWT_SECRET_KEY, "access");
  return result.ok ? { uuid: result.claims.sub, token, claims: result.claims } : null;
}

// ── password hashing ──────────────────────────────────────────────────────────

/**
 * Hash format: `pbkdf2$sha256$<iterations>$<base64url salt>$<base64url dk>`.
 *
 * The iterations are stored per-hash so the cost can be raised later without
 * invalidating existing credentials — on the next successful login we detect a
 * hash with a lower iteration count and transparently rehash (below).
 */
export type PasswordHash = {
  algorithm: "pbkdf2" | "legacy-sha256";
  iterations: number;
  salt: string;
  hash: string;
};

const PBKDF2_PREFIX = "pbkdf2$sha256$";
/** Defect S4: the legacy scheme was `sha256(password + STATIC_SALT)` — no
 *  per-user salt, no iterations, rainbow-tableable. New passwords never use
 *  it, but it is still verified so existing accounts keep working. */
const LEGACY_PREFIX = "legacy-sha256$";

export async function hashPassword(password: string, env: Env): Promise<string> {
  const iterations = parseIterations(env.PBKDF2_ITERATIONS);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(password, salt, iterations);
  return `${PBKDF2_PREFIX}${iterations}$${b64urlEncode(salt)}$${b64urlEncode(dk)}`;
}

export async function verifyPassword(password: string, stored: string, env: Env): Promise<boolean> {
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const parts = stored.split("$");
    const iterStr = parts[2];
    const saltStr = parts[3];
    const hashStr = parts[4];
    if (!iterStr || !saltStr || !hashStr) return false;
    const iterations = Number(iterStr);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const dk = await pbkdf2(password, b64urlDecode(saltStr), iterations);
    return timingSafeEqual(dk, b64urlDecode(hashStr));
  }
  if (stored.startsWith(LEGACY_PREFIX)) {
    const legacy = stored.slice(LEGACY_PREFIX.length);
    const digest = await sha256Hex(password + env.SALT);
    return timingSafeEqualString(digest, legacy);
  }
  // v2.0.1 writes bcrypt, which needs `bcryptjs` (~50-100 ms CPU) and would
  // blow the 10 ms budget. The target cluster is empty, so there is nothing to
  // migrate; this branch exists only so a stray legacy hash fails closed rather
  // than being silently accepted.
  return false;
}

/** True when the stored hash should be upgraded on this login. */
export function needsRehash(stored: string, env: Env): boolean {
  if (!stored.startsWith(PBKDF2_PREFIX)) return true;
  const iterations = Number(stored.split("$")[2]);
  return !Number.isFinite(iterations) || iterations < parseIterations(env.PBKDF2_ITERATIONS);
}

export function parseIterations(raw: string | undefined): number {
  const n = Number(raw ?? 210_000);
  return Number.isFinite(n) && n >= 100_000 ? n : 210_000;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password) as unknown as ArrayBuffer, "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as ArrayBuffer, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value) as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-and-content safe comparison; avoids leaking position via timing. */
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