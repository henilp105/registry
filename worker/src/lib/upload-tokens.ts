/**
 * Upload tokens — replaces the embedded arrays on `v2.0.1` (defect D4).
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 * `v2.0.1` stored upload tokens as `{token, createdAt, createdBy}` pushed onto
 * `namespaces.upload_tokens[]` via `$addToSet`:
 *
 *   - **Never revocable.** No endpoint deletes them and there is no revoke
 *     route, so a leaked token stayed valid for its full lifetime.
 *   - **Stored in plaintext.** Anyone with read access to the database — or to
 *     an unauthenticated `/registry/archives` mongodump, which lists the whole
 *     `registry-*.tar.gz` set (defect D5) — could mint package uploads.
 *   - **Unbounded array growth.** `$addToSet` of a fresh uuid each time, with
 *     no sweep, so `namespaces` documents grow without limit and eventually
 *     collide with MongoDB's 16 MB document cap.
 *   - **Two incompatible shapes.** Namespaces used `createdAt`/`createdBy`;
 *     packages used `created_at`/`created_by`. `upload()` read `createdAt` but
 *     searched only `db.namespaces`, so package-level tokens were inert —
 *     `POST /packages/<ns>/<pkg>/uploadToken` minted tokens that could not
 *     authorise anything.
 *
 * ── Replacement ──────────────────────────────────────────────────────────────
 * One `upload_tokens` collection (indexed in Phase 2):
 *   - only `token_hash` is stored, so a database dump yields nothing usable
 *   - explicitly revocable
 *   - scoped to a namespace and optionally a single package
 *   - expiring, with `expires_at` indexed so a cron sweep can reclaim space
 *   - `last_used_at` / `use_count` recorded, so an active token is visible to
 *     its owner and a leaked one is noticeable
 *
 * The **plaintext token is returned exactly once**, at creation, and never
 * again. `fpm publish --token <value>` passes it in a form field on every
 * upload, so it must be a bearer secret the CLI holds in its config.
 */

// Defect D73: a private copy of `isHex24`, byte-identical to the one in
// `./ids`. One implementation now serves both.
import { isHex24 } from "./ids";
import { db, type Env } from "../db/client";
import { toMillis } from "../db/bson";
import { randomToken, sha256Hex } from "./tokens";
import { logger } from "./logger";

export { tokenAllows, type UploadTokenVerdict } from "./permissions";

/** The Phase 2 index names, so a bad migration fails loudly. */
export const UPLOAD_TOKEN_COLLECTION = "upload_tokens";

export type UploadTokenScope = "namespace" | "package";

export type UploadTokenDoc = {
  _id?: unknown;
  /** SHA-256 hex of the token. The token itself is never persisted. */
  token_hash: string;
  kind: "upload";
  scope: UploadTokenScope;
  /** ObjectId hex of the namespace this token may publish into. */
  namespace_id: string;
  /** ObjectId hex, when the token is limited to one package. */
  package_id: string | null;
  /** The user's uuid, so `POST /packages` can attribute the upload without a JWT. */
  created_by: string;
  created_by_username: string;
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
  use_count: number;
  /** Optional ceiling. `null` means limited only by `expires_at`. */
  max_uses: number | null;
  revoked_at: Date | null;
};

/**
 * Default lifetime.
 *
 * 7 days, matching `check_token_expiry` in `v2.0.1`, so existing users who
 * generated a token before this migration are not surprised. `help.js` tells
 * users a token "will be valid for 1 week", so this also aligns the code with
 * the documentation.
 */
export const DEFAULT_TTL_DAYS = 7;

/** Guard against a caller asking for a token valid forever. */
export const MAX_TTL_DAYS = 30;

export type IssuedToken = {
  /** Plaintext. Returned to the caller once and never recoverable again. */
  token: string;
  doc: Omit<UploadTokenDoc, "token_hash">;
};

/** Mint a token and persist only its hash. */
export async function issueUploadToken(
  env: Env,
  params: {
    scope: UploadTokenScope;
    namespaceId: string;
    packageId?: string | null;
    createdBy: string;
    createdByUsername: string;
    ttlDays?: number;
    maxUses?: number | null;
  },
): Promise<IssuedToken> {
  const ttl = clampTtl(params.ttlDays);
  const token = randomToken();

  const doc = {
    kind: "upload" as const,
    scope: params.scope,
    namespace_id: params.namespaceId,
    package_id: params.packageId ?? null,
    created_by: params.createdBy,
    created_by_username: params.createdByUsername,
    created_at: new Date(),
    expires_at: new Date(Date.now() + ttl * 86_400_000),
    last_used_at: null,
    use_count: 0,
    max_uses: params.maxUses ?? null,
    revoked_at: null,
  };

  await db(env, {
    kind: "insertOne",
    collection: UPLOAD_TOKEN_COLLECTION,
    doc: { ...doc, token_hash: await sha256Hex(token) },
  });

  return { token, doc };
}

export type TokenVerdict =
  | { valid: true; namespaceId: string; packageId: string | null; createdBy: string }
  | { valid: false; reason: "unknown" | "expired" | "revoked" | "exhausted" };

/**
 * Validate a presented token and record the use.
 *
 * Everything that can make a token invalid is expressed in a single
 * conditional `updateOne` filter, so the claim is atomic: a token cannot be
 * validated and then race into being exhausted or revoked between the check and
 * the write.
 *
 * The failure reasons are deliberately coarse. They are logged server-side but
 * returned as a generic message, so a caller cannot use this endpoint to
 * distinguish "never existed" from "expired" — that difference is only useful
 * to someone probing for valid tokens.
 */
export async function consumeUploadToken(env: Env, presented: string): Promise<TokenVerdict> {
  const tokenHash = await sha256Hex(presented);
  const now = new Date();

  const claimed = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: UPLOAD_TOKEN_COLLECTION,
    filter: {
      token_hash: tokenHash,
      kind: "upload",
      revoked_at: null,
      expires_at: { $gt: now },
      // Defect D85: `max_uses` was never enforced atomically — an exhausted
      // token was still claimed until some other condition failed. `$or` keeps
      // the null-ceiling (unlimited) case matchable.
      $or: [
        { max_uses: null },
        { $expr: { $lt: ["$use_count", "$max_uses"] } },
      ],
    },
    update: {
      $set: { last_used_at: now },
      $inc: { use_count: 1 },
    },
  })) as { modifiedCount: number };

  if (!claimed || claimed.modifiedCount === 0) {
    // Distinguish the reasons for our own logs only.
    const existing = (await db<Pick<UploadTokenDoc, "revoked_at" | "expires_at" | "use_count" | "max_uses"> | null>(
      env,
      { kind: "findOne", collection: UPLOAD_TOKEN_COLLECTION, filter: { token_hash: tokenHash }, projection: { revoked_at: 1, expires_at: 1, use_count: 1, max_uses: 1 } },
    )) as Pick<UploadTokenDoc, "revoked_at" | "expires_at" | "use_count" | "max_uses"> | null;

    if (!existing) return { valid: false, reason: "unknown" };
    if (existing.revoked_at) return { valid: false, reason: "revoked" };
    // Defect D90: this was `existing.expires_at.getTime()`. Values that come
    // back through the Durable Object have been through `toRpcSafe`, which
    // renders every Date as an ISO *string* -- so `.getTime` was not a
    // function, and any expired or exhausted token threw a TypeError out of
    // `consumeUploadToken`. That surfaced as HTTP 500 on an unauthenticated
    // public endpoint, on an input any caller can produce, instead of the
    // intended 401.
    if (toMillis(existing.expires_at) <= now.getTime()) return { valid: false, reason: "expired" };
    if (existing.max_uses !== null && (existing.use_count ?? 0) >= existing.max_uses) {
      return { valid: false, reason: "exhausted" };
    }
    return { valid: false, reason: "unknown" };
  }

  const doc = (await db<UploadTokenDoc | null>(env, {
    kind: "findOne",
    collection: UPLOAD_TOKEN_COLLECTION,
    filter: { token_hash: tokenHash },
    projection: { namespace_id: 1, package_id: 1, created_by: 1 },
  })) as UploadTokenDoc | null;

  if (!doc) {
    // Should be impossible: the update matched a moment ago.
    logger.error("upload token claimed but then not found", { tokenHash });
    return { valid: false, reason: "unknown" };
  }

  return {
    valid: true,
    namespaceId: doc.namespace_id,
    packageId: doc.package_id,
    createdBy: doc.created_by,
  };
}

/** Revoke a token. Only the creator or a site admin may call this. */
export async function revokeUploadToken(env: Env, tokenId: string, actorUuid: string): Promise<boolean> {
  // D81: reject a malformed id up front. The old `{ $invalid: hex }` sentinel
  // is a real aggregation operator, so the server *error*ed instead of
  // returning zero matches -- a 500 for a simply-not-found token.
  if (!isHex24(tokenId)) {
    logger.info("upload token revoke matched nothing", { tokenId, actorUuid });
    return false;
  }
  // Defect D85: the docstring promised "creator or site admin only" but no
  // ownership/role check existed, so any authenticated user could revoke any
  // token by id. Non-owner and non-admin both get `false` (→ 404), so the
  // endpoint never leaks whether a token id exists.
  const token = (await db<{ created_by?: string } | null>(env, {
    kind: "findOne",
    collection: UPLOAD_TOKEN_COLLECTION,
    filter: { _id: tokenId },
    projection: { created_by: 1 },
  })) as { created_by?: string } | null;
  if (!token) return false;
  if (token.created_by !== actorUuid) {
    const actor = (await db<{ roles?: unknown } | null>(env, {
      kind: "findOne",
      collection: "users",
      filter: { uuid: actorUuid },
      projection: { roles: 1 },
    })) as { roles?: unknown } | null;
    const roles = Array.isArray(actor?.roles) ? (actor!.roles as unknown[]) : [];
    if (!roles.includes("admin")) {
      logger.info("upload token revoke on a foreign token", { tokenId, actorUuid });
      return false;
    }
  }
  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: UPLOAD_TOKEN_COLLECTION,
    filter: { _id: tokenId, revoked_at: null },
    update: { $set: { revoked_at: new Date() } },
  })) as { modifiedCount: number };

  const revoked = result.modifiedCount > 0;
  if (!revoked) logger.info("upload token revoke matched nothing", { tokenId, actorUuid });
  return revoked;
}

/** Delete tokens that expired long ago. Called from the nightly cron. */
export async function sweepExpiredTokens(env: Env, olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const result = (await db<{ deletedCount: number }>(env, {
    kind: "deleteMany",
    collection: UPLOAD_TOKEN_COLLECTION,
    filter: { expires_at: { $lt: cutoff } },
  })) as { deletedCount: number };

  const removed = result?.deletedCount ?? 0;
  if (removed > 0) logger.info("swept expired upload tokens", { removed });
  return removed;
}

function clampTtl(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return DEFAULT_TTL_DAYS;
  return Math.min(Math.max(Math.floor(requested), 1), MAX_TTL_DAYS);
}