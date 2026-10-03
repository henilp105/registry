/**
 * Which MongoDB operations may be replayed after a transient error.
 *
 * Split into its own module, with no imports, so it can be unit tested in plain
 * Node. `mongo-pool.ts` imports `cloudflare:workers`, which a Node test runner
 * cannot resolve -- so a policy this consequential, sitting inside an untestable
 * file, would be a policy nothing could hold in place.
 *
 * ── Defect D93 ──────────────────────────────────────────────────────────────
 * `execute()` retried **every** operation kind once, while `mongo-pool.ts`'s own
 * header claimed "Retry *idempotent* operations once on a transient Mongo error".
 * There was no idempotency check in the loop.
 *
 * That matters because `isRetryable` matches genuinely ambiguous outcomes, not
 * just confirmed failures:
 *
 *   - `91 ShutdownInProgress` — the server may or may not have applied the write.
 *   - any network error raised while reading the *reply* to a write the server
 *     had already committed.
 *
 * Replaying such a call verbatim duplicates it. Concretely: an
 * `auth_tokens` or `upload_tokens` `insertOne` retried after an ambiguous error
 * leaves two documents, and a retried `transaction` re-runs its entire cascade --
 * which is the one shape where a duplicate is a data-integrity problem rather
 * than a cosmetic one.
 *
 * The rule is therefore asymmetric on purpose. A lost retry costs one extra
 * round trip and the caller sees the error; an applied-twice write costs
 * correctness. So anything not positively known to be replay-safe is not
 * retried.
 */

import type { MongoOp, TransactionStep } from "./mongo-pool";

/**
 * Reads and local computation. Nothing is persisted, so there is nothing to
 * duplicate — retrying is free and strictly better than failing.
 */
const PURE_KINDS = new Set([
  "ping",
  "rateLimit",
  "findOne",
  "find",
  "count",
  "aggregate",
  "hashPassword",
  "verifyPassword",
  "sha256",
  "ensureIndexes",
]);

export function isReplaySafe(op: MongoOp): boolean {
  if (PURE_KINDS.has(op.kind)) return true;

  switch (op.kind) {
    // Deleting an already-deleted set is a no-op, so a delete is safe even
    // though it is a write.
    case "deleteOne":
    case "deleteMany":
      return true;

    // Safe only where the filter guards the very field the update changes, so a
    // second application matches nothing.
    case "updateOne":
    case "updateMany":
      return isGuardedWrite(op.update, op.filter);

    // `bootstrap` re-runs index creation, which MongoDB makes idempotent, but it
    // is a maintenance path that is never expected to run twice and its
    // steps are not individually guarded. Not retried.
    case "insertOne":
    case "transaction":
    case "bootstrap":
      return false;

    default:
      // An op kind added later is not retried until someone has thought about
      // it. Defaulting to `true` here would make the safe choice the one that
      // requires remembering.
      return false;
  }
}

/**
 * True when the update `$set`s at least one field that the filter also
 * constrains, which is what makes a replay a no-op rather than a second write.
 *
 * Examples that qualify:
 *   `{revoked_at: null}`            + `{$set: {revoked_at: now}}`
 *   `{used_at: null}`               + `{$set: {used_at: now}}`
 *   `{"versions.version": {$ne: v}}` + `{$push: {versions: doc}}`
 *
 * The `$push` case is not `$set`, so it is deliberately **not** accepted here:
 * `versionAppendFilter` guards its append with `versions.version: { $ne }`, but
 * proving that from the update alone would mean pattern-matching a guard the
 * caller may have written differently. A publish that fails once and is
 * retried by the client is correct; a publish that is silently applied twice
 * is not.
 */
export function isGuardedWrite(
  update: Record<string, unknown> | undefined,
  filter: Record<string, unknown>,
): boolean {
  if (!update || typeof update !== "object") return false;
  if (!filter || typeof filter !== "object") return false;

  const $set = (update as { $set?: unknown }).$set;
  if (!$set || typeof $set !== "object" || Array.isArray($set)) return false;

  return Object.keys($set as Record<string, unknown>).some((field) => field in filter);
}

/**
 * Whether every step of a transaction is individually replay-safe.
 *
 * Exported for the test that documents why `transaction` is refused outright
 * even when its steps happen to look safe: a replay is only safe if the *whole*
 * sequence is, and a partially-applied cascade cannot be reasoned about from
 * the step list alone.
 */
export function allStepsReplaySafe(steps: TransactionStep[]): boolean {
  return steps.every((step) => {
    if (step.kind === "insertOne") return false;
    if (step.kind === "deleteOne" || step.kind === "deleteMany") return true;
    return isGuardedWrite(step.update, step.filter);
  });
}
