/**
 * Live integration tests against MongoDB Atlas.
 *
 * Skipped unless `MONGODB_TEST_URI` is set, so `npm test` stays hermetic for
 * contributors with no database. CI supplies it as a secret.
 *
 * These exercise the pieces that unit tests cannot reach: that the unique
 * indexes from Phase 2 actually block duplicates, that the single-use token
 * claim is genuinely atomic under concurrency, and that the defect D9 semver
 * fix produces a different answer from the legacy string sort on a real
 * document.
 *
 * It deliberately writes to a throwaway database and drops it afterwards.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db, type IndexDescription, type MongoClientOptions } from "mongodb";
import { hashPassword, verifyPassword, needsRehash, DEFAULT_PBKDF2_ITERATIONS } from "../src/lib/password";
import { signToken, verifyToken } from "../src/lib/jwt";
import {
  validateUsername,
  validateEmail,
  validatePassword,
  validatePackageName,
  validateVersion,
  validateLicense,
  latestVersion,
} from "../src/lib/validators";
import { randomId, randomToken, sha256Hex } from "../src/lib/tokens";
import { INDEX_SPEC, EXPECTED_COLLECTIONS } from "../src/db/indexes";

const URI = process.env.MONGODB_TEST_URI;
const TEST_DB = `fpmregistry_test_${randomId(6)}`;
const JWT_SECRET = "integration-test-secret-value-0123456789";
const SALT = "MYSALT";
/** Lowered from the production 210k so the suite stays fast. Cost is not what
 *  these tests are checking. */
const ITERATIONS = 10_000;

const describeLive = URI ? describe : describe.skip;

describeLive("live MongoDB integration", () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    // Cast for the same reason as src/db/mongo-pool.ts: mongodb 7 extends the
    // Node TLS/socket option shapes, which @types/node types differently.
    const options = { serverSelectionTimeoutMS: 15_000 } as unknown as MongoClientOptions;
    client = new MongoClient(URI as string, options);
    await client.connect();
    db = client.db(TEST_DB);

    // Apply the real Phase 2 index set. This means the duplicate-key tests
    // below are exercising the indexes the Worker actually ships, not a
    // hand-rolled subset, and it covers the ordering constraint that
    // createIndexes needs the collections to exist first.
    for (const name of EXPECTED_COLLECTIONS) {
      await db.createCollection(name).catch(() => {});
    }
    for (const entry of INDEX_SPEC) {
      await db.collection(entry.collection).createIndexes(entry.indexes as IndexDescription[]);
    }
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await db.dropDatabase().catch(() => {});
    await client.close();
  }, 30_000);

  // ── index enforcement (Phase 2) ────────────────────────────────────────────

  it("creates the full Phase 2 index set", async () => {
    const expected = INDEX_SPEC.reduce((n, e) => n + e.indexes.length, 0);
    let actual = 0;
    for (const entry of INDEX_SPEC) {
      const indexes = await db.collection(entry.collection).indexes();
      // Subtract the implicit _id index.
      actual += indexes.length - 1;
    }
    expect(actual).toBe(expected);
  }, 30_000);

  it("blocks duplicate usernames via the unique index", async () => {
    const username = `dupe_${randomId(4)}`;
    const base = {
      username,
      email: `${username}@example.com`,
      password: "x",
      uuid: randomId(32),
      roles: ["user"],
    };
    await db.collection("users").insertOne({ ...base });
    await expect(
      db.collection("users").insertOne({ ...base, email: `alt-${username}@example.com`, uuid: randomId(32) }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("blocks duplicate package name+namespace via the unique index", async () => {
    const ns = new ObjectId();
    const base = { name: "dupe-pkg", namespace: ns, namespace_name: "dupe", versions: [] };
    await db.collection("packages").insertOne({ ...base });
    await expect(db.collection("packages").insertOne({ ...base })).rejects.toMatchObject({ code: 11000 });
  });

  // ── single-use tokens (defect D2) ──────────────────────────────────────────

  it("lets exactly one concurrent request claim a single-use token", async () => {
    // This is the property a read-then-write would break. Ten simultaneous
    // claims must yield exactly one winner.
    const raw = randomToken();
    await db.collection("auth_tokens").insertOne({
      token_hash: await sha256Hex(raw),
      kind: "verify_email",
      user_uuid: randomId(32),
      expires_at: new Date(Date.now() + 86_400_000),
      used_at: null,
    });

    const hash = await sha256Hex(raw);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.collection("auth_tokens").updateOne(
          { token_hash: hash, kind: "verify_email", used_at: null, expires_at: { $gt: new Date() } },
          { $set: { used_at: new Date() } },
        ),
      ),
    );

    expect(results.filter((r) => r.modifiedCount === 1)).toHaveLength(1);
  }, 30_000);

  it("refuses an expired token", async () => {
    const raw = randomToken();
    await db.collection("auth_tokens").insertOne({
      token_hash: await sha256Hex(raw),
      kind: "password_reset",
      user_uuid: randomId(32),
      expires_at: new Date(Date.now() - 1000),
      used_at: null,
    });
    const r = await db.collection("auth_tokens").updateOne(
      { token_hash: await sha256Hex(raw), kind: "password_reset", used_at: null, expires_at: { $gt: new Date() } },
      { $set: { used_at: new Date() } },
    );
    expect(r.modifiedCount).toBe(0);
  });

  // ── the D9 semver fix, against a real document ─────────────────────────────

  it("reports a different latest version than the legacy string sort (defect D9)", async () => {
    await db.collection("packages").insertOne({
      name: "ordered-demo",
      namespace_name: "demo",
      is_deprecated: false,
      versions: [
        { version: "0.9.0", download_url: "/tarballs/a" },
        { version: "0.10.0", download_url: "/tarballs/b" },
        { version: "0.1.0", download_url: "/tarballs/c" },
      ],
    });
    const pkg = await db.collection("packages").findOne({ name: "ordered-demo" });
    const versions = (pkg?.versions ?? []).map((v: { version: string }) => v.version);

    // What v2.0.1 ships: `sorted(versions, key=lambda x: x.version)`.
    const legacySort = [...versions].sort();
    expect(legacySort.at(-1)).toBe("0.9.0");

    // What the client is told is `latest_version_data`.
    expect(latestVersion(versions)).toBe("0.10.0");
  });

  // ── password round trip against a stored document ───────────────────────────

  it("hashes, stores, and re-verifies a password across a reload", async () => {
    const uuid = randomId(32);
    const password = "correct-horse-battery-staple";
    const stored = await hashPassword(password, ITERATIONS);
    await db.collection("users").insertOne({ uuid, username: `u_${uuid.slice(0, 6)}`, password: stored });

    const reloaded = await db.collection("users").findOne({ uuid });
    expect(await verifyPassword(password, String(reloaded?.password), SALT)).toBe(true);
    expect(await verifyPassword("wrong", String(reloaded?.password), SALT)).toBe(false);
    expect(needsRehash(String(reloaded?.password), DEFAULT_PBKDF2_ITERATIONS)).toBe(true);
  });

  it("mints a JWT that the Durable Object's verify path accepts", async () => {
    const uuid = randomId(32);
    const access = await signToken(uuid, JWT_SECRET, "access");
    const result = await verifyToken(access, JWT_SECRET, "access");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.sub).toBe(uuid);
  });

  // ── validators used on the upload path ─────────────────────────────────────

  it("rejects the injection payloads that reached validate.py", () => {
    for (const bad of ["evil;rm -rf /", "evil$(id)", "evil`id`", "../../etc/passwd", "a/b"]) {
      expect(validatePackageName(bad).ok).toBe(false);
    }
  });

  it("accepts an SPDX expression and rejects a lookalike", () => {
    expect(validateLicense("MIT OR Apache-2.0").ok).toBe(true);
    expect(validateLicense("(MIT OR BSD-3-Clause) AND Apache-2.0").ok).toBe(true);
    expect(validateLicense("ABC").ok).toBe(false);
  });

  it("applies the signup field rules", () => {
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("valid_user").ok).toBe(true);
    expect(validateEmail("nope").ok).toBe(false);
    expect(validatePassword("short").ok).toBe(false);
    expect(validateVersion("0.0.0").ok).toBe(false);
  });
});