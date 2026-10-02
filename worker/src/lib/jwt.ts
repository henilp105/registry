/**
 * HS256 JSON Web Tokens on WebCrypto.
 *
 * Deliberately dependency-free. `jose` or `jsonwebtoken` would add tens of KiB
 * and burn CPU we do not have inside a Worker's 10 ms budget, and HS256 is just
 * HMAC-SHA256 over a JSON payload.
 *
 * ── Compatibility with the Flask deployment ──────────────────────────────────
 * `flask-jwt-extended` emits HS256 with identity in `sub` plus
 * `type: "access" | "refresh"`, `fresh`, `iat`, `exp`, `nbf` and `jti`. This
 * reproduces that claim set exactly, so tokens minted by the old deployment
 * stay valid through the canary (Phase 10) and existing logged-in users are not
 * logged out when traffic shifts.
 */

export type TokenType = "access" | "refresh";

export type Claims = {
  /** The account uuid. `flask-jwt-extended` calls this the identity. */
  sub: string;
  type: TokenType;
  fresh?: boolean;
  iat: number;
  exp: number;
  nbf: number;
  jti: string;
  [k: string]: unknown;
};

export type SignOptions = {
  /** Days until expiry. The Flask app used 90 for access, 180 for refresh. */
  expiresInDays?: number;
  fresh?: boolean;
  /** Overridable for tests. */
  now?: number;
};

/** An authenticated caller: the account uuid plus the token that proved it. */
export type AuthContext = {
  uuid: string;
  token: string;
  claims: Claims;
};

export type VerifyFailure =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "not-yet-valid"
  | "wrong-type"
  | "missing-sub";

export type VerifyResult = { ok: true; claims: Claims } | { ok: false; reason: VerifyFailure };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

// ── sign / verify ─────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signToken(
  uuid: string,
  secret: string,
  type: TokenType,
  opts: SignOptions = {},
): Promise<string> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
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
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput) as BufferSource);
  return `${signingInput}.${b64urlEncode(mac)}`;
}

/**
 * Verify a token.
 *
 * The signature check goes through `crypto.subtle.verify`, which is
 * constant-time, so there is no timing oracle on the secret.
 */
export async function verifyToken(
  token: string,
  secret: string,
  expect?: TokenType,
  nowSeconds?: number,
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [header, payload, signature] = parts as [string, string, string];

  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(signature) as BufferSource,
      encoder.encode(`${header}.${payload}`) as BufferSource,
    );
    if (!valid) return { ok: false, reason: "bad-signature" };
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let claims: Claims;
  try {
    claims = JSON.parse(decoder.decode(b64urlDecode(payload))) as Claims;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return { ok: false, reason: "expired" };
  // Small clock-skew allowance, mirroring the JWT `leeway` concept.
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) return { ok: false, reason: "not-yet-valid" };
  if (expect && claims.type !== expect) return { ok: false, reason: "wrong-type" };
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return { ok: false, reason: "missing-sub" };

  return { ok: true, claims };
}