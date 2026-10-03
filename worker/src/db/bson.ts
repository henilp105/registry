import { ObjectId } from "mongodb";

/**
 * BSON ↔ RPC representation rules.
 *
 * ── The constraint this exists to satisfy ───────────────────────────────────
 * workerd's RPC layer **cannot serialise a BSON ObjectId**. It throws
 * `Could not serialize object of type "_ObjectId"`, which turned every read route
 * into a 500 because the MongoDB driver returns `_id` as an ObjectId unless a
 * projection excludes it, and Mongo's `$project` includes `_id` by default
 * (defect D49).
 *
 * So ids must leave the Durable Object as hex strings. Which immediately creates
 * the opposite problem: a handler reads `doc._id`, gets a string, and feeds it
 * back into the next query — and MongoDB does **not** coerce a 24-character hex
 * string to an ObjectId. Measured against MongoDB 8.0.34 / driver 7.7.0:
 *
 *     { _id: ObjectId(...) }   -> 1 match
 *     { _id: "<24 hex>" }      -> 0 matches
 *
 * These two functions are the entire round trip, and they live together so the
 * pair can be reasoned about as one thing.
 *
 * ── Why applying them at ~30 call sites was not an option ────────────────────
 * Because a forgotten one is a **silent zero-match**: no error, just an empty
 * result that reads as "not found". That is not hypothetical. Applying the
 * outbound conversion to `#run` but forgetting transactional filters and
 * transactional inserts produced:
 *
 *   - D55 — every cascade delete matched nothing and returned HTTP 200
 *     "deleted successfully"
 *   - D57 — publishes wrote `namespace` as the *string* "6abf72a8…", so every
 *     later read of that package 404'd
 *
 * So both directions are applied centrally, in the Durable Object, over every
 * query fragment and every insert. The unit tests in `bson.test.ts` pin the
 * invariants, including the round trip that those two defects violated.
 */

/** A string of exactly 24 hex characters is assumed to be an id. See below. */
const HEX24 = /^[0-9a-fA-F]{24}$/;

/**
 * The assumption this module makes, stated where it is made.
 *
 * A 24-character hex string is treated as an id. Checked against the schema: the
 * only other hex-valued fields are `sha256` (64 characters) and upload-token
 * digests (64 characters), so there is no collision today. If a future field ever
 * holds a 24-hex value that is *not* an id, its meaning would silently change --
 * which is the trade, made deliberately rather than by omission.
 */
export function isIdLike(value: unknown): boolean {
  return typeof value === "string" && HEX24.test(value);
}

/**
 * Convert hex id strings back into ObjectIds, recursively, inside any query
 * fragment or document.
 *
 * Applies to filters, updates, pipelines and inserted documents alike, which is
 * what makes the hex form returned by `toRpcSafe` safe to use anywhere.
 */
/**
 * Operator keys whose string value is an *operand*, never an id.
 *
 * Defect D95. The rewrite below is indiscriminate: it converts any 24-hex string
 * anywhere in a query into an ObjectId, which is what makes `{"_id": "<hex>"}`
 * work against documents the Flask app wrote. But `$search` takes a *search
 * term*. `GET /packages?query=0123456789abcdef01234567` is a text plan (>= 2
 * chars, no `*`/`$`), so `buildMatchFilter` emits
 * `{$text: {$search: "0123..."}}`, the rewrite made it an ObjectId, and
 * MongoDB rejected the whole pipeline. Since the aggregate and the count sit in
 * one `Promise.all`, that was a 500 on a public search rather than an empty
 * result.
 *
 * Excluding the operand keys is precise rather than blanket: `_id`, `namespace`
 * and friends still convert, and `$in` members still convert, because there a
 * 24-hex string really is an id.
 */
const OPERAND_KEYS = new Set(["$search", "$regex", "$options", "$comment"]);

/**
 * Escape hatch for fragments that must reach MongoDB exactly as written.
 *
 * The rewrite converts every 24-hex string into an ObjectId, which is right
 * for id fields but wrong for operands that quote both *forms* of a legacy
 * field at once (a legacy package's `maintainers` array holds hex strings
 * while every new document holds ObjectIds). Wrapping the fragment in
 * `rawBson` passes it through toBsonQueries untouched.
 */
const RAW = Symbol.for("fpm.bson.raw");

export function rawBson<T>(value: T): T {
  return { [RAW]: value } as unknown as T;
}

/** Both stored forms of a user id: ObjectId (worker-written) and the legacy hex string. */
function idPair(id: unknown): { oid: ObjectId; hex: string } | null {
  const hex =
    typeof id === "string"
      ? id
      : typeof (id as { toHexString?: unknown })?.toHexString === "function"
        ? (id as { toHexString(): string }).toHexString()
        : null;
  if (!hex || !HEX24.test(hex)) return null;
  return { oid: new ObjectId(hex), hex };
}

/** Array-contains either form of the id (member of legacy or modern docs). */
export function memberOf(id: unknown): unknown {
  const pair = idPair(id);
  return pair ? rawBson({ $in: [pair.oid, pair.hex] }) : id;
}

/** Array does NOT contain either form of the id. */
export function notMemberOf(id: unknown): unknown {
  const pair = idPair(id);
  return pair ? rawBson({ $nin: [pair.oid, pair.hex] }) : id;
}

/** `$pull` condition matching either form of the id, for update documents. */
export function pullBothForms(id: unknown): unknown {
  const pair = idPair(id);
  return pair ? rawBson({ $in: [pair.oid, pair.hex] }) : id;
}

export function toBsonQueries<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map(toBsonQueries) as T;

  if (value === null || value === undefined) return value as T;

  if (typeof value === "string") {
    return (HEX24.test(value) ? new ObjectId(value) : value) as T;
  }

  if (typeof value !== "object") return value as T;

  // Already the right type; leave alone so a Date does not become a plain object.
  if (value instanceof Date || value instanceof ObjectId) return value as T;

  // Explicit raw fragment: never rewritten.
  if (RAW in (value as Record<PropertyKey, unknown>)) {
    return (value as Record<PropertyKey, unknown>)[RAW] as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = OPERAND_KEYS.has(k) ? v : toBsonQueries(v);
  }
  return out as T;
}

/**
 * Convert BSON values into something workerd's RPC layer can serialise.
 *
 * Lossy in one direction only: an ObjectId becomes its hex string, which is what
 * the API already exposes as `_id` everywhere else. Dates become ISO strings,
 * `bigint` becomes `number`, and binary becomes a plain array. Everything else is
 * returned as-is, so exactly one place in the codebase knows BSON's type surface.
 */
export function toRpcSafe<T = unknown>(value: unknown): T {
  if (value === null || value === undefined) return null as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (typeof value === "bigint") return Number(value) as T;
  if (Array.isArray(value)) return value.map(toRpcSafe) as T;

  if (typeof value === "object") {
    // BSON ObjectId, and anything else driver-specific exposing toHexString().
    const hex = (value as { toHexString?: unknown }).toHexString;
    if (typeof hex === "function") return (value as { toHexString(): string }).toHexString() as T;

    // A null-prototype object is already plain data.
    if (Object.getPrototypeOf(value) === null) return value as T;

    // Buffer / Uint8Array is already RPC-safe; Date was handled above.
    if (value instanceof Uint8Array) return Array.from(value) as T;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toRpcSafe(v);
    return out as T;
  }

  return value as T;
}

/**
 * Milliseconds for a value read back out of MongoDB, whatever shape it arrived in.
 *
 * Exists because `toRpcSafe` above turns every Date into an ISO string, so a
 * value read through the Durable Object is *not* a Date any more. Calling
 * `.getTime()` on one is a `TypeError`, and a `TypeError` inside a route is a
 * 500 — which is how an expired upload token came to answer 500 instead of 401
 * (defect D90).
 *
 * Accepts a Date (used directly), an ISO string, an epoch number, or nullish
 * (returns `fallback`). Anything unparseable returns the fallback too: this is
 * used in expiry checks, where "I cannot read it" must not read as "not
 * expired".
 */
export function toMillis(value: unknown, fallback = 0): number {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : fallback;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? fallback : t;
  }
  return fallback;
}
