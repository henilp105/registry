import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { isIdLike, toBsonQueries, toRpcSafe } from "../src/db/bson";

/**
 * The BSON ↔ RPC round trip, pinned.
 *
 * ── Why these are unit tests and not integration tests ───────────────────────
 * Both defects this file guards were found by running against a live cluster, and
 * neither had a test. They were both caused by *partially applying* this round
 * trip:
 *
 *   - D55 — the outbound conversion was applied everywhere and the inbound one to
 *     `#run` only, forgetting transactional filters. Every cascade delete matched
 *     zero rows and returned HTTP 200 "Namespace deleted successfully" with the
 *     document still present.
 *   - D57 — `insertOne` was never converted, so publishes stored `namespace` as
 *     the string "6abf72a8…" and every later read of that package 404'd.
 *
 * A unit test cannot catch a *missing call site* in another file. What it can do
 * is pin the round-trip property that those call sites exist to serve, so the
 * conversion is a tested, documented function with one home rather than inline
 * logic in five places — and so `isIdLike`'s assumption is stated where it is
 * made.
 */

const HEX = "6abf72a87e2f3c973be6bb0c";
const otherHex = "6abf706cd7cdaaacd3567ec8";

describe("toRpcSafe: BSON → RPC", () => {
  it("renders an ObjectId as its hex string, because workerd cannot serialise it", () => {
    expect(toRpcSafe(new ObjectId(HEX))).toBe(HEX);
  });

  it("converts a Date to ISO, so it survives the boundary as a string", () => {
    const when = new Date("2026-10-02T00:00:00.000Z");
    expect(toRpcSafe(when)).toBe("2026-10-02T00:00:00.000Z");
  });

  it("converts bigint to number, which is JSON-representable", () => {
    expect(toRpcSafe(10n)).toBe(10);
  });

  it("converts binary to a plain array", () => {
    expect(toRpcSafe(new Uint8Array([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it("preserves null and normalises undefined to null", () => {
    // The legacy API omits fields rather than sending null, so a missing key has
    // to serialise predictably rather than as `undefined`.
    expect(toRpcSafe(null)).toBeNull();
    expect(toRpcSafe(undefined)).toBeNull();
  });

  it("walks nested documents and arrays", () => {
    const id = new ObjectId(HEX);
    const out = toRpcSafe<Record<string, unknown>>({
      _id: id,
      author: id,
      maintainers: [id],
      nested: { deep: { _id: id } },
      versions: [{ version: "1.0.0", _id: id }],
    });
    expect(out).toEqual({
      _id: HEX,
      author: HEX,
      maintainers: [HEX],
      nested: { deep: { _id: HEX } },
      versions: [{ version: "1.0.0", _id: HEX }],
    });
  });

  it("leaves ordinary values untouched", () => {
    const input = { s: "text", n: 7, b: true, nil: null, arr: [1, "two"] };
    expect(toRpcSafe(input)).toEqual(input);
  });
});

describe("toBsonQueries: RPC → BSON", () => {
  it("converts a 24-hex string back into an ObjectId", () => {
    const out = toBsonQueries<{ _id: unknown }>({ _id: HEX });
    expect(out._id).toBeInstanceOf(ObjectId);
    expect(String(out._id)).toBe(HEX);
  });

  it("is case-insensitive, and normalises to the stored form", () => {
    expect(String(toBsonQueries<{ _id: unknown }>({ _id: HEX.toUpperCase() })._id)).toBe(HEX);
  });

  it("converts ids nested in arrays, objects and $in clauses", () => {
    const out = toBsonQueries<Record<string, unknown>>({
      namespace: HEX,
      packages: [HEX, otherHex],
      _id: { $in: [HEX, otherHex] },
      nested: { owner: HEX },
    });
    expect(out.namespace).toBeInstanceOf(ObjectId);
    expect((out.packages as unknown[]).every((v) => v instanceof ObjectId)).toBe(true);
    expect((out._id as { $in: unknown[] }).$in.every((v) => v instanceof ObjectId)).toBe(true);
    expect((out.nested as { owner: unknown }).owner).toBeInstanceOf(ObjectId);
  });

  it("leaves a 64-character hex digest alone", () => {
    // `sha256` and upload-token digests are 64 hex characters. Converting one of
    // those to an ObjectId would corrupt a security control, so the 24-character
    // bound is doing real work rather than being decoration.
    const digest = "a".repeat(64);
    expect(toBsonQueries<{ sha256: unknown }>({ sha256: digest }).sha256).toBe(digest);
  });

  it("leaves a uuid alone", () => {
    const uuid = "1f0c9a2e-4b7d-4c1a-9f3e-8d2b6a5c4e10";
    expect(toBsonQueries<{ uuid: unknown }>({ uuid }).uuid).toBe(uuid);
  });

  it("leaves a Date and an ObjectId untouched", () => {
    const when = new Date("2026-01-01T00:00:00.000Z");
    const id = new ObjectId(HEX);
    const out = toBsonQueries<{ at: unknown; id: unknown }>({ at: when, id });
    expect(out.at).toBe(when);
    expect(out.id).toBe(id);
  });

  it("does not mistake a version string or a URL for an id", () => {
    const out = toBsonQueries<Record<string, unknown>>({
      version: "1.0.0",
      download_url: "/tarballs/stdlib/json-fortran/1.0.0",
      sha256: "b".repeat(64),
    });
    expect(out.version).toBe("1.0.0");
    expect(out.download_url).toBe("/tarballs/stdlib/json-fortran/1.0.0");
  });
});

describe("the round trip, which is the property D55 and D57 both violated", () => {
  it("preserves id identity through toRpcSafe then toBsonQueries", () => {
    // A handler reads `_id` off a fetched document, then feeds it into the next
    // query or the next insert. If this does not hold, the second operation
    // silently matches nothing -- which is exactly D55 (cascade deletes matched
    // nothing) and D57 (publishes stored a string where an ObjectId belonged).
    const original = { _id: new ObjectId(HEX), author: new ObjectId(otherHex) };

    const out = toBsonQueries<typeof original>(toRpcSafe(original));

    expect(out._id).toBeInstanceOf(ObjectId);
    expect(String(out._id)).toBe(HEX);
    expect(out.author).toBeInstanceOf(ObjectId);
    expect(String(out.author)).toBe(otherHex);
  });

  it("round-trips a document shaped like a real package", () => {
    // The exact field layout `POST /packages` writes. `namespace` is the foreign
    // key that D57 stored as a string.
    const stored = {
      name: "json-fortran",
      namespace: new ObjectId(HEX),
      namespace_name: "stdlib",
      versions: [{ version: "0.10.0", sha256: "c".repeat(64) }],
      ratings: { users: {}, counts: { "5": 3 } },
      created_at: new Date("2026-02-11T00:00:00.000Z"),
    };

    const round = toBsonQueries<typeof stored>(toRpcSafe(stored));

    expect(round.namespace).toBeInstanceOf(ObjectId);
    expect(String(round.namespace)).toBe(HEX);
    expect(round.namespace_name).toBe("stdlib");
    expect(round.versions[0]?.sha256).toBe("c".repeat(64));
  });

  it("produces a value the RPC layer can serialise", () => {
    // The reason toRpcSafe exists. A raw ObjectId here is what 500'd every read.
    const serialised = JSON.parse(JSON.stringify(toRpcSafe({ _id: new ObjectId(HEX) })));
    expect(serialised._id).toBe(HEX);
  });
});

describe("isIdLike states the assumption in one place", () => {
  it.each([
    [HEX, true],
    [HEX.toUpperCase(), true],
    ["a".repeat(64), false],
    ["6abf72a87e2f3c973be6bb0", false], // 23 chars
    ["6abf72a87e2f3c973be6bb0cc", false], // 25 chars
    ["zzzzzzzzzzzzzzzzzzzzzzzz", false],
    ["1.0.0", false],
    ["", false],
  ])("%j -> %s", (value, expected) => {
    expect(isIdLike(value)).toBe(expected);
  });

  it("agrees with toBsonQueries about what gets converted", () => {
    // The two must not drift: a value is an id exactly when the query converter
    // rewrites it.
    for (const value of [HEX, HEX.toUpperCase(), "a".repeat(64), "1.0.0", "", "not-an-id"]) {
      const converted = toBsonQueries<{ v: unknown }>({ v: value }).v;
      expect(converted instanceof ObjectId, `disagreement on ${JSON.stringify(value)}`).toBe(
        isIdLike(value),
      );
    }
  });
});
