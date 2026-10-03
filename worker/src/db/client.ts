/**
 * Typed client for the MongoPool Durable Object.
 *
 * Every route in the Worker goes through here rather than touching the driver
 * directly. Two reasons:
 *   1. It is the only place that knows the connection lives in a DO — routes
 *      stay oblivious, which keeps the 10 ms CPU budget an implementation
 *      detail rather than a concern every handler has to respect.
 *   2. It gives one place to add result shaping, which matters because BSON
 *      `Date` objects serialise to `{}` through `JSON.stringify` and the
 *      frontend slices `createdAt` with `.slice(4,16)`.
 */

import { POOL_NAME, type MongoOp, type PoolEnv } from "./mongo-pool";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";

export type PoolBinding = DurableObjectNamespace<import("./mongo-pool").MongoPool>;

export type Env = PoolEnv & {
  MONGO_POOL: PoolBinding;
  TARBALLS: R2Bucket;
  CACHE: KVNamespace;
  ENVIRONMENT: string;
  SALT: string;
  PBKDF2_ITERATIONS: string;
  HOST: string;
  ALLOWED_ORIGINS: string;
  JWT_SECRET_KEY: string;
  /**
   * Only used to bootstrap the *first* admin on an empty database, and only
   * while the users collection is empty. See the defect D1 note in
   * src/routes/auth.ts — this is deliberately a one-shot latch, not a
   * permanent skeleton key.
   */
  SUDO_PASSWORD?: string;
  // Optional — only needed in production. See src/lib/mail.ts.
  /**
   * Shared secret for the GitHub Actions validation callback. Deliberately a
   * separate credential from JWT_SECRET_KEY: this endpoint can mark any package
   * as verified, so it must not be reachable with a token ordinary maintainers
   * hold. Fails closed when unset.
   */
  VALIDATION_SECRET?: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
};

/**
 * Send one operation to the region's pool and await its result.
 *
 * `locationHint: "apac"` biases placement toward the Atlas region (the
 * cluster lives in the APAC group) so the round trip stays short.
 */
export async function db<T = unknown>(env: Env, op: MongoOp): Promise<T> {
  const id = env.MONGO_POOL.idFromName(POOL_NAME);
  const stub = env.MONGO_POOL.get(id, { locationHint: "apac" });
  return (await stub.execute({ op })) as T;
}

/** Fire-and-forget variant for writes that do not need the result. */
export function dbAsync(env: Env, op: MongoOp): Promise<unknown> {
  const id = env.MONGO_POOL.idFromName(POOL_NAME);
  return env.MONGO_POOL.get(id, { locationHint: "apac" }).execute({ op });
}

/**
 * Lowercase hex SHA-256 of an artifact, computed in the pool.
 *
 * It lives here, next to `db`, rather than in lib/storage.ts, because
 * `storage.ts` must stay importable from plain Node: it is the module the
 * checksum tests exercise, and importing the Durable Object from it would pull
 * `cloudflare:workers` into a Node test runner and fail the whole suite at
 * import time rather than at the assertion. See the `sha256` op in
 * mongo-pool.ts (defect D91) for why this cannot run in the request handler.
 */
export async function sha256InPool(env: Env, bytes: Uint8Array): Promise<string> {
  const digest = await db<string>(env, { kind: "sha256", bytes });
  if (typeof digest !== "string") {
    throw new Error("digest op returned a non-string value");
  }
  return digest;
}

// ── collection names ─────────────────────────────────────────────────────────

export const COLLECTIONS = {
  users: "users",
  packages: "packages",
  namespaces: "namespaces",
  /** GridFS files — kept for read-path compatibility with v2.0.1 documents. */
  tarballFiles: "tarballs.files",
  tarballChunks: "tarballs.chunks",
  /** Upload tokens, moved out of embedded arrays — see defect D4. */
  uploadTokens: "upload_tokens",
  refreshTokens: "refresh_tokens",
  maliciousReports: "malicious_reports",
} as const;

// ── response shaping ─────────────────────────────────────────────────────────

/**
 * Convert BSON values into JSON-safe primitives.
 *
 * This is not cosmetic. `JSON.stringify(new Date())` yields `"1970-01-01T..."`
 * only via `toJSON`, but a `Long`, an `ObjectId` or a nested raw BSON
 * document serialise as `{}`. The frontend calls `.slice()` on `createdAt`
 * (namespace page: `.slice(4,16)`) and on `user.createdAt` (`.slice(0,16)`),
 * so a missing value crashes the UI. Everything leaving the API goes through
 * here.
 */
export function toJsonSafe<T>(value: T): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // BSON types (ObjectId, Long, Decimal128, …) expose a usable string form
    // via toHexString()/toString(). Detect them by constructor rather than by
    // calling toString blindly, which would yield "[object Object]".
    const ctorName = Object.getPrototypeOf(obj)?.constructor?.name;
    if (ctorName === "ObjectId" || ctorName === "Long" || ctorName === "Decimal128") {
      const hex = (obj as { toHexString?: () => string }).toHexString;
      if (typeof hex === "function") return hex.call(obj);
      const str = (obj as { toString: () => string }).toString;
      return str.call(obj);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = toJsonSafe(v);
    return out;
  }
  return value;
}