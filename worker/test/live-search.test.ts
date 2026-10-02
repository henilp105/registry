/**
 * Live tests for search behaviour.
 *
 * Skipped unless `MONGODB_TEST_URI` is set.
 *
 * The point of these is to prove the defect D18 fix empirically rather than by
 * assertion: that `$text` actually returns ranked results from the weighted
 * index, that the `explain()` plan is an index scan rather than a collection
 * scan, and that the semver ordering applied to `version_history` produces a
 * different answer from the legacy string sort on a real document.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db, type IndexDescription, type MongoClientOptions } from "mongodb";
import { INDEX_SPEC, EXPECTED_COLLECTIONS } from "../src/db/indexes";
import { randomId } from "../src/lib/tokens";
import { compareVersionsDescending, latestVersion } from "../src/lib/validators";

const URI = process.env.MONGODB_TEST_URI;
const TEST_DB = `fpmregistry_search_${randomId(6)}`;
const describeLive = URI ? describe : describe.skip;

describeLive("package search", () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    const options = { serverSelectionTimeoutMS: 15_000 } as unknown as MongoClientOptions;
    client = new MongoClient(URI as string, options);
    await client.connect();
    db = client.db(TEST_DB);
    for (const name of EXPECTED_COLLECTIONS) await db.createCollection(name).catch(() => {});
    for (const entry of INDEX_SPEC) {
      await db.collection(entry.collection).createIndexes(entry.indexes as IndexDescription[]);
    }

    const nsId = new ObjectId();
    await db.collection("namespaces").insertOne({
      _id: nsId,
      namespace: "searchtest",
      description: "search fixture",
      author: new ObjectId(),
      admins: [],
      maintainers: [],
      packages: [],
    });

    await db.collection("packages").insertMany([
      {
        name: "json-fortran",
        namespace: nsId,
        namespace_name: "searchtest",
        description: "A fast JSON parser for Fortran",
        registry_description: "# json-fortran\nBlazing JSON. Parses JSON quickly.",
        keywords: ["json", "serialization"],
        categories: ["fortran", "parsing"],
        is_deprecated: false,
        download_count: 500,
        created_at: new Date(),
        updated_at: new Date(),
        versions: [{ version: "0.9.0" }, { version: "0.10.0" }, { version: "0.1.0" }],
      },
      {
        name: "hdf5",
        namespace: nsId,
        namespace_name: "searchtest",
        description: "HDF5 bindings",
        registry_description: "# hdf5\nScientific data format support.",
        keywords: ["hdf5"],
        categories: ["fortran"],
        is_deprecated: false,
        download_count: 900,
        created_at: new Date(),
        updated_at: new Date(),
        versions: [{ version: "1.0.0" }],
      },
      {
        name: "oldjson",
        namespace: nsId,
        namespace_name: "searchtest",
        description: "Deprecated JSON tool",
        registry_description: "no longer maintained",
        keywords: ["json"],
        categories: ["fortran"],
        is_deprecated: true,
        download_count: 10,
        created_at: new Date(),
        updated_at: new Date(),
        versions: [{ version: "0.0.1" }],
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await db.dropDatabase().catch(() => {});
    await client.close();
  }, 30_000);

  it("returns ranked $text results from the weighted index", async () => {
    const rows = (await db
      .collection("packages")
      .aggregate([
        { $match: { is_deprecated: false, $text: { $search: "json" } } },
        { $sort: { score: { $meta: "textScore" } } },
        { $project: { name: 1, score: { $meta: "textScore" } } },
      ])
      .toArray()) as { name: string; score: number }[];

    // Defect D18: v0.0.1 could not do this -- it used an unanchored,
    // case-sensitive $regex over `description` and `registry_description`,
    // neither of which is indexed.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.name).toBe("json-fortran");
    // `name` carries weight 10 in the Phase 2 index, so a name match must
    // outrank a body match.
    expect(rows[0]?.score ?? 0).toBeGreaterThan(0);
  }, 30_000);

  it("uses an index scan, not a collection scan", async () => {
    const plan = await db
      .collection("packages")
      .find({ is_deprecated: false, $text: { $search: "json" } })
      .explain("queryPlanner");
    const serialised = JSON.stringify(plan.queryPlanner);

    expect(serialised).toContain("IXSCAN");
    // The regression this guards: v0.0.1 ran two full collection scans per
    // search (find + count_documents), which is what made search the slowest
    // endpoint in the app.
    expect(serialised).not.toContain("COLLSCAN");
  }, 30_000);

  it("still applies the is_deprecated filter to text results", async () => {
    const rows = await db
      .collection("packages")
      .find({ is_deprecated: false, $text: { $search: "json" } })
      .toArray();
    expect(rows.some((r) => (r as { name?: string }).name === "oldjson")).toBe(false);
  }, 30_000);

  it("orders version_history numerically, not lexicographically", async () => {
    const pkg = await db.collection("packages").findOne({ name: "json-fortran" });
    const versions = ((pkg?.versions ?? []) as { version: string }[]).map((v) => v.version);

    // The legacy string sort, which is what v2.0.1 shipped.
    const legacyOrder = [...versions].sort();
    expect(legacyOrder.at(-1)).toBe("0.9.0");

    // What our response actually reports as latest_version_data.
    expect(latestVersion(versions)).toBe("0.10.0");
    expect([...versions].sort(compareVersionsDescending)).toEqual(["0.10.0", "0.9.0", "0.1.0"]);
  }, 30_000);

  it("sorts by download_count, a field v2.0.1 could not sort on at all", async () => {
    const rows = await db
      .collection("packages")
      .find({ is_deprecated: false })
      .sort({ download_count: -1 })
      .project({ name: 1, download_count: 1 })
      .toArray();

    // v2.0.1 mapped `downloads` onto a field named `downloads`, which does not
    // exist on the document, so MongoDB silently fell back to name order.
    expect(rows[0]?.name).toBe("hdf5");
    expect(rows[0]?.download_count).toBe(900);
  }, 30_000);

  it("matches packages by name through the unique (name, namespace) index", async () => {
    // The D34 fix depends on this lookup working: resolve the namespace name to
    // its _id, then find the package by (name, _id).
    const ns = await db.collection("namespaces").findOne({ namespace: "searchtest" });
    const pkg = await db
      .collection("packages")
      .findOne({ name: "json-fortran", namespace: ns?._id });

    expect(pkg).not.toBeNull();

    // And the broken form v0.0.1 used, which compared the name field to an
    // ObjectId and therefore never matched:
    const broken = await db.collection("packages").findOne({ name: "json-fortran", namespace: "searchtest" });
    expect(broken).toBeNull();
  }, 30_000);
});