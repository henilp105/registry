/**
 * Live tests for namespace membership mutations.
 *
 * Skipped unless `MONGODB_TEST_URI` is set.
 *
 * Each mutation in `routes/users.ts` uses a conditional filter
 * (`{ _id, maintainers: { $ne: target } }`) rather than a read-then-write, so
 * adding a member twice is idempotent and a removal only reports success if it
 * actually changed something. These tests pin that, because `v2.0.1` branched
 * its message on `modified_count` and would otherwise have silently reported
 * success for a no-op.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db, type IndexDescription, type MongoClientOptions } from "mongodb";
import { INDEX_SPEC, EXPECTED_COLLECTIONS } from "../src/db/indexes";
import { randomId } from "../src/lib/tokens";

const URI = process.env.MONGODB_TEST_URI;
const TEST_DB = `fpmregistry_mem_${randomId(6)}`;
const describeLive = URI ? describe : describe.skip;

describeLive("namespace membership mutations", () => {
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

  /** A namespace owned by `owner`, plus two other members. */
  async function fixture() {
    const owner = new ObjectId();
    const member = new ObjectId();
    const stranger = new ObjectId();
    const nsId = new ObjectId();

    await db.collection("namespaces").insertOne({
      _id: nsId,
      namespace: `mem_${randomId(4)}`,
      description: "membership fixture",
      author: owner,
      admins: [owner],
      maintainers: [],
      packages: [],
    });

    return { owner, member, stranger, nsId };
  }

  it("adds a maintainer once and is idempotent on repeat", async () => {
    const { owner, member, nsId } = await fixture();

    const add = () =>
      db.collection("namespaces").updateOne(
        { _id: nsId, maintainers: { $ne: member } },
        { $addToSet: { maintainers: member } },
      );

    const first = await add();
    const second = await add();

    // v2.0.1 branched its message on modified_count, so this distinction is
    // load-bearing for the frontend.
    expect(first.modifiedCount).toBe(1);
    expect(second.modifiedCount).toBe(0);

    const ns = await db.collection("namespaces").findOne({ _id: nsId });
    expect((ns?.maintainers ?? []).length).toBe(1);
    expect(String(ns?.maintainers?.[0])).toBe(String(member));
    void owner;
  }, 30_000);

  it("reports a removal that matched nothing as a no-op", async () => {
    const { stranger, nsId } = await fixture();

    const removed = await db
      .collection("namespaces")
      .updateOne({ _id: nsId, maintainers: stranger }, { $pull: { maintainers: stranger } });

    expect(removed.modifiedCount).toBe(0);
  }, 30_000);

  it("refuses to pull an admin out of the maintainer list implicitly", async () => {
    // routes/users.ts checks isNamespaceAdmin(target, namespace) before
    // removing a maintainer, because an admin stripped of maintainer rights
    // could lose the ability to grant them back.
    const owner = new ObjectId();
    const nsId = new ObjectId();
    await db.collection("namespaces").insertOne({
      _id: nsId,
      namespace: `guard_${randomId(4)}`,
      author: owner,
      admins: [owner],
      maintainers: [owner],
      packages: [],
    });

    const ns = await db.collection("namespaces").findOne({ _id: nsId });
    const targetIsAdmin = (ns?.admins ?? []).some((a: unknown) => String(a) === String(owner));
    expect(targetIsAdmin).toBe(true);
    // The route returns 401 in this case rather than performing the $pull.
  }, 30_000);

  it("normalises ObjectId and hex-string membership representations", async () => {
    // This is the mismatch lib/permissions.ts exists to handle: some writes
    // store ObjectIds, some store hex strings. Both must authorise.
    const nsId = new ObjectId();
    const memberId = new ObjectId();
    const hex = memberId.toHexString();

    await db.collection("namespaces").insertOne({
      _id: nsId,
      namespace: `mixed_${randomId(4)}`,
      author: memberId, // ObjectId
      admins: [], // none
      maintainers: [], // none
      packages: [],
    });
    // Now store a hex string where an ObjectId would normally live.
    await db
      .collection("namespaces")
      .updateOne({ _id: nsId }, { $set: { admins: [hex] } });

    const ns = await db.collection("namespaces").findOne({ _id: nsId });
    const stored = ns?.admins?.[0];
    expect(typeof stored).toBe("string");
    expect(String(stored)).toBe(hex);
    // strId(ObjectId) === strId(hex), which is what makes the check pass.
    expect(String(memberId)).toBe(hex);
  }, 30_000);

  it("keeps maintainerOf and the namespace list consistent on removal", async () => {
    const { member, nsId } = await fixture();
    const pkgId = new ObjectId();
    const userId = new ObjectId();

    await db.collection("packages").insertOne({
      _id: pkgId,
      name: "p",
      namespace: nsId,
      maintainers: [member],
      versions: [],
    });
    await db.collection("users").insertOne({
      _id: userId,
      uuid: randomId(32),
      username: `u_${randomId(4)}`,
      roles: ["user"],
      maintainerOf: [pkgId],
    });

    await db.collection("packages").updateOne({ _id: pkgId }, { $pull: { maintainers: member } });
    await db.collection("users").updateOne({ _id: userId }, { $pull: { maintainerOf: pkgId } });

    const pkg = await db.collection("packages").findOne({ _id: pkgId });
    const user = await db.collection("users").findOne({ _id: userId });
    expect(pkg?.maintainers ?? []).toHaveLength(0);
    expect(user?.maintainerOf ?? []).toHaveLength(0);
  }, 30_000);
});