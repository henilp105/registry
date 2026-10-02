import { describe, expect, it } from "vitest";
import { isDuplicateKeyError, versionAppendFilter } from "../src/lib/publish";

/**
 * The two upload-path invariants that concurrency testing found broken, pinned so
 * they cannot quietly regress.
 *
 * Both were found by `scripts/write_path_fuzz.mjs` against the live cluster and
 * neither had a test. They are here because "we fixed it" is not a property; a
 * property is something a test can fail.
 */

/**
 * Build the error the way MongoDB does, with and without its `code`.
 *
 * The `bare` form matters. workerd's RPC layer does not carry arbitrary
 * properties when an error crosses the Durable Object boundary, so `err.code`
 * arrives `undefined` and a code-only check never matches. That is not a
 * hypothetical: the first version of the duplicate-key handler returned HTTP 500
 * on exactly that, while the log showed a perfectly clear
 * `E11000 duplicate key error ... packages_name_namespace_unique`.
 */
function duplicateKeyError({ withCode = true }: { withCode?: boolean } = {}): Error & { code?: number } {
  const message =
    'E11000 duplicate key error collection: fpmregistry.packages ' +
    'index: packages_name_namespace_unique dup key: { name: "racepkg", namespace: ObjectId("6abf72a87e2f3c973be6bb0c") }';
  const err = new Error(message) as Error & { code?: number };
  if (withCode) err.code = 11000;
  return err;
}

describe("isDuplicateKeyError", () => {
  it("matches a real duplicate-key error carrying its code", () => {
    expect(isDuplicateKeyError(duplicateKeyError())).toBe(true);
  });

  it("still matches when the RPC boundary has stripped `code`", () => {
    // The D59 regression. Without this, a publish that lost the create race
    // returned 500 instead of folding its version into the package that the
    // unique index had just created.
    const stripped = duplicateKeyError({ withCode: false });
    expect(stripped.code).toBeUndefined();
    expect(isDuplicateKeyError(stripped)).toBe(true);
  });

  it("matches on the duplicate-key variant too", () => {
    expect(isDuplicateKeyError(Object.assign(new Error("E11001 duplicate key"), { code: 11001 }))).toBe(true);
  });

  it("does not match unrelated failures", () => {
    for (const err of [
      new Error("not authorized"),
      Object.assign(new Error("TarballTooLarge"), { code: 413 }),
      Object.assign(new Error("network timeout"), { code: 189 }),
      new TypeError("x is not a function"),
    ]) {
      expect(isDuplicateKeyError(err), err.message).toBe(false);
    }
  });

  it("does not throw on non-objects", () => {
    // Defensive: a handler must not turn a bad error into a second bad error.
    for (const value of [null, undefined, "E11000", 42, true]) {
      expect(isDuplicateKeyError(value)).toBe(false);
    }
  });
});

describe("versionAppendFilter", () => {
  it("guards on the version so a repeated publish cannot duplicate it", () => {
    // The D60 regression. A bare `$push` is atomic but not idempotent: eight
    // concurrent publishes of 1.0.0 left six identical entries in `versions`,
    // which then repeated in `version_history`.
    const filter = versionAppendFilter("6abf72a87e2f3c973be6bb0c", "1.0.0");
    expect(filter).toEqual({
      _id: "6abf72a87e2f3c973be6bb0c",
      "versions.version": { $ne: "1.0.0" },
    });
  });

  it("scopes to the package, so one package's versions cannot block another's", () => {
    const a = versionAppendFilter("6abf72a87e2f3c973be6bb0c", "1.0.0");
    const b = versionAppendFilter("6abf706cd7cdaaacd3567ec8", "1.0.0");
    expect(a._id).not.toBe(b._id);
  });

  it("distinguishes versions exactly, rather than by prefix or coercion", () => {
    // "1.0.0" must not block "1.0.1", and "1.0" must not block "1.0.0".
    expect(versionAppendFilter("x", "1.0.1")["versions.version"]).toEqual({ $ne: "1.0.1" });
    expect(versionAppendFilter("x", "1.0.0")["versions.version"]).toEqual({ $ne: "1.0.0" });
  });
});
