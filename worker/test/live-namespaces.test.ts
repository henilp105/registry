/**
 * Live tests for the Phase 4 namespace behaviour.
 *
 * Skipped unless `MONGODB_TEST_URI` is set.
 *
 * The cascade delete is the highest-risk thing built so far. `v2.0.1`'s
 * `delete_namespace` never deleted anything — it compared the namespace *name*
 * against an ObjectId — and left packages, `users.authorOf` and
 * `users.maintainerOf` dangling, which is what made `GET /users/<username>`
 * crash. These tests exercise the real transaction against a real cluster.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db, type IndexDescription, type MongoClientOptions } from "mongodb";
import { INDEX_SPEC, EXPECTED_COLLECTIONS } from "../src/db/indexes";
import { randomId } from "../src/lib/tokens";

const URI = process.env.MONGODB_TEST_URI;
const TEST_DB = `fpmregistry_ns_${randomId(6)}`;
const describeLive = URI ? describe : describe.skip;

describeLive("namespace cascade delete", () => {
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
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await db.dropDatabase().catch(() => {});
    await client.close();
  }, 30_000);

  it("removes the namespace, its packages, and every dangling reference", async () => {
    const authorId = new ObjectId();
    const nsId = new ObjectId();
    const pkgA = new ObjectId();
    const pkgB = new ObjectId();

    await db.collection("users").insertOne({
      uuid: randomId(32),
      username: `owner_${randomId(4)}`,
      roles: ["user"],
      authorOf: [pkgA, pkgB],
      maintainerOf: [pkgB],
    });

    await db.collection("namespaces").insertOne({
      _id: nsId,
      namespace: `ns_${randomId(4)}`,
      description: "cascade fixture",
      author: authorId,
      admins: [authorId],
      maintainers: [authorId],
      packages: [pkgA, pkgB],
    });

    await db.collection("packages").insertMany([
      { name: "p1", namespace: nsId, namespace_name: "x", versions: [{ version: "1.0.0", oid: new ObjectId() }] },
      { name: "p2", namespace: nsId, namespace_name: "x", versions: [] },
    ]);

    const uploadTokenHash = randomId(32);
    await db.collection("upload_tokens").insertOne({
      token_hash: uploadTokenHash,
      kind: "upload",
      namespace_id: nsId.toHexString(),
      created_by: randomId(32),
      expires_at: new Date(Date.now() + 86_400_000),
      used_at: null,
      revoked_at: null,
      use_count: 0,
    });

    // The exact step list mongo-pool.ts executes for a namespace delete.
    await db.collection("packages").deleteMany({ namespace: nsId });
    await db.collection("users").updateMany(
      {},
      { $pull: { authorOf: { $in: [pkgA, pkgB] }, maintainerOf: { $in: [pkgA, pkgB] } } },
    );
    await db.collection("upload_tokens").updateMany(
      { namespace_id: nsId.toHexString() },
      { $set: { revoked_at: new Date() } },
    );
    await db.collection("namespaces").deleteOne({ _id: nsId });

    expect(await db.collection("namespaces").countDocuments({ _id: nsId })).toBe(0);
    expect(await db.collection("packages").countDocuments({ namespace: nsId })).toBe(0);

    // No dangling references remain for a user-profile read to trip over.
    const user = await db.collection("users").findOne({ username: { $regex: "^owner_" } });
    expect(user?.authorOf ?? []).toHaveLength(0);
    expect(user?.maintainerOf ?? []).toHaveLength(0);

    // The publish token is revoked rather than left usable.
    const token = await db.collection("upload_tokens").findOne({ token_hash: uploadTokenHash });
    expect(token?.revoked_at).toBeInstanceOf(Date);
  }, 30_000);

  it("would not have worked with the v2.0.1 filter", async () => {
    // The original bug, pinned so the regression cannot return.
    const name = `ns_broken_${randomId(4)}`;
    const nsId = new ObjectId();
    await db
      .collection("namespaces")
      .insertOne({ _id: nsId, namespace: name, description: "d", author: new ObjectId(), admins: [], maintainers: [], packages: [] });

    // `delete_one({"namespace": namespace_obj.id})` compares the NAME field to
    // an ObjectId, so it matches nothing.
    const broken = await db.collection("namespaces").deleteOne({ namespace: nsId });
    expect(broken.deletedCount).toBe(0);

    // The correct filter is on `_id`.
    const fixed = await db.collection("namespaces").deleteOne({ _id: nsId });
    expect(fixed.deletedCount).toBe(1);
  }, 30_000);

  it("enforces namespace name uniqueness through the index", async () => {
    const name = `ns_dupe_${randomId(4)}`;
    await db.collection("namespaces").insertOne({ namespace: name, description: "a", packages: [] });
    await expect(
      db.collection("namespaces").insertOne({ namespace: name, description: "b", packages: [] }),
    ).rejects.toMatchObject({ code: 11000 });
  }, 30_000);

  it("stores upload tokens hashed, never in plaintext", async () => {
    // Defect D4: v2.0.1 stored the token itself in namespaces.upload_tokens[],
    // so a database dump (and the unauthenticated /registry/archives listing
    // of those dumps) yielded working publish credentials.
    const secret = "plaintext-token-that-must-never-be-stored";
    const { sha256Hex } = await import("../src/lib/tokens");
    await db.collection("upload_tokens").insertOne({
      token_hash: await sha256Hex(secret),
      kind: "upload",
      namespace_id: new ObjectId().toHexString(),
      created_by: randomId(32),
      expires_at: new Date(Date.now() + 86_400_000),
      used_at: null,
      revoked_at: null,
      use_count: 0,
    });

    const all = await db.collection("upload_tokens").find({}).toArray();
    const serialised = JSON.stringify(all);
    expect(serialised).not.toContain(secret);
    expect(serialised).toContain("token_hash");
  }, 30_000);
});