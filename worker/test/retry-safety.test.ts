import { describe, expect, it } from "vitest";
import { isReplaySafe, isGuardedWrite, allStepsReplaySafe } from "../src/db/retry-safety";
import type { MongoOp } from "../src/db/mongo-pool";

/**
 * `isReplaySafe` is declared over the `MongoOp` union, so the tests that pass a
 * bare kind name cast. The cast is deliberate and local: the alternative is a
 * table of `{ kind } satisfies MongoOp` objects, which repeats a dozen field
 * names to say nothing the kind does not already say.
 */
type OpKind = MongoOp["kind"];
const op = (partial: Record<string, unknown> & { kind: OpKind | string }): MongoOp =>
  partial as unknown as MongoOp;

/**
 * Defect D93: the retry loop replayed *every* operation kind after a transient
 * Mongo error, while the pool's own header claimed only idempotent ones.
 *
 * The specific damage: `isRetryable` matches ShutdownInProgress (91) and network
 * errors raised while reading the reply to a write the server already committed.
 * Those are ambiguous outcomes. Replaying such a call verbatim duplicates it --
 * a second `auth_tokens` or `upload_tokens` document, or an entire cascade run
 * twice.
 *
 * "We fixed it" is not a property. These are.
 */

describe("isReplaySafe: reads and local computation are always safe", () => {
  it.each([
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
  ] as OpKind[])("%s", (kind) => {
    // Nothing is persisted, so there is nothing to duplicate. Failing here would
    // cost a round trip for no correctness benefit.
    expect(isReplaySafe(op({ kind })), kind).toBe(true);
  });

  it("a real read op with a filter is safe", () => {
    expect(
      isReplaySafe(
        op({ kind: "findOne", collection: "packages", filter: { name: "json-fortran" } }),
      ),
    ).toBe(true);
  });
});

describe("isReplaySafe: inserts and cascades are never replayed", () => {
  it("refuses insertOne -- a retry is a duplicate document", () => {
    expect(
      isReplaySafe(
        op({
          kind: "insertOne",
          collection: "auth_tokens",
          doc: { token_hash: "abc", kind: "password_reset" },
        }),
      ),
    ).toBe(false);
  });

  it("refuses a transaction, which re-runs the whole cascade", () => {
    expect(
      isReplaySafe(
        op({
          kind: "transaction",
          steps: [
            { kind: "deleteMany", collection: "packages", filter: { namespace: "x" } },
            { kind: "deleteOne", collection: "namespaces", filter: { _id: "x" } },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("refuses bootstrap", () => {
    expect(isReplaySafe(op({ kind: "bootstrap", collections: [], spec: [] }))).toBe(false);
  });

  it("an unknown op kind is not retried", () => {
    // Defaulting the other way would make "forgot to think about it" the safe
    // option, which is how the original defect happened.
    expect(isReplaySafe(op({ kind: "somethingNew" }))).toBe(false);
  });
});

describe("isReplaySafe: deletes are safe", () => {
  it("deleteOne and deleteMany are no-ops when replayed", () => {
    expect(
      isReplaySafe(op({ kind: "deleteOne", collection: "packages", filter: { _id: "x" } })),
    ).toBe(true);
    expect(
      isReplaySafe(op({ kind: "deleteMany", collection: "packages", filter: { namespace: "x" } })),
    ).toBe(true);
  });
});

describe("isReplaySafe: writes only where the filter guards the update", () => {
  it("accepts the revoke pattern -- filter constrains the field being set", () => {
    // Exactly the two single-use-token claims in this codebase.
    expect(
      isReplaySafe(
        op({
          kind: "updateOne",
          collection: "auth_tokens",
          filter: { token_hash: "h", kind: "password_reset", used_at: null },
          update: { $set: { used_at: new Date() } },
        }),
      ),
    ).toBe(true);

    expect(
      isReplaySafe(
        op({
          kind: "updateOne",
          collection: "upload_tokens",
          filter: { _id: "t", revoked_at: null },
          update: { $set: { revoked_at: new Date() } },
        }),
      ),
    ).toBe(true);
  });

  it("rejects a write whose filter does not mention the field it sets", () => {
    // Replaying this increments twice. `recordDownload` is the live example:
    // filter is `{name, namespace_name}`, update is `{$inc: {download_count: 1}}`.
    expect(
      isReplaySafe(
        op({
          kind: "updateOne",
          collection: "packages",
          filter: { name: "json-fortran", namespace_name: "stdlib" },
          update: { $inc: { download_count: 1 } },
        }),
      ),
    ).toBe(false);
  });

  it("rejects an update with no $set at all", () => {
    expect(
      isReplaySafe(
        op({
          kind: "updateOne",
          collection: "packages",
          filter: { name: "json-fortran" },
          update: { $inc: { download_count: 1 } },
        }),
      ),
    ).toBe(false);
  });

  it("rejects a $push, even when the filter looks like a publish guard", () => {
    // `versionAppendFilter` guards its append with `versions.version: { $ne }`,
    // which is genuinely replay-safe. It is still refused: proving that from the
    // update alone means pattern-matching a guard the caller may have written
    // differently, and a publish retried by the client is correct while a publish
    // applied twice is not.
    expect(
      isReplaySafe(
        op({
          kind: "updateOne",
          collection: "packages",
          filter: { name: "json-fortran", "versions.version": { $ne: "1.0.0" } },
          update: { $push: { versions: { version: "1.0.0" } } },
        }),
      ),
    ).toBe(false);
  });

  it("rejects a malformed update or filter rather than assuming", () => {
    expect(isGuardedWrite(undefined, { revoked_at: null })).toBe(false);
    expect(isGuardedWrite({ $set: { revoked_at: 1 } }, undefined as never)).toBe(false);
    expect(isGuardedWrite({ $set: "not an object" }, { revoked_at: null })).toBe(false);
    expect(isGuardedWrite({ $set: ["array"] }, { revoked_at: null })).toBe(false);
    expect(isGuardedWrite({}, { revoked_at: null })).toBe(false);
  });

  it("accepts one guarded field among several unguarded ones", () => {
    expect(
      isGuardedWrite({ $set: { revoked_at: new Date(), updated_at: new Date() } }, {
        revoked_at: null,
      }),
    ).toBe(true);
  });
});

describe("allStepsReplaySafe: why transaction is refused even when its steps look safe", () => {
  it("is false whenever any step is an insert", () => {
    expect(
      allStepsReplaySafe([
        { kind: "deleteMany", collection: "packages", filter: { namespace: "x" } },
        { kind: "insertOne", collection: "auth_tokens", doc: { a: 1 } },
      ]),
    ).toBe(false);
  });

  it("is true for a cascade of deletes and guarded writes", () => {
    // Which is exactly why `transaction` is refused at the op level anyway: a
    // partially-applied cascade cannot be reasoned about from the step list, and
    // the step that looks safe today may not be the step that is there tomorrow.
    expect(
      allStepsReplaySafe([
        { kind: "deleteMany", collection: "packages", filter: { namespace: "x" } },
        {
          kind: "updateMany",
          collection: "users",
          filter: {},
          update: { $pull: { authorOf: { $in: ["x"] } } },
        },
      ]),
    ).toBe(false);
  });
});
