/**
 * One-shot MongoDB bootstrap for the fpm registry.
 *
 * Creates every collection in EXPECTED_COLLECTIONS (if absent) and applies the
 * full index set from INDEX_SPEC — the same definitions the hourly cron in
 * src/index.ts and MongoPool#bootstrap apply, so this script is idempotent and
 * safe to re-run.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://..." MONGO_DB_NAME=fpmregistry \
 *     node --experimental-strip-types scripts/mongo-bootstrap.ts
 *
 * Defaults MONGO_DB_NAME to "fpmregistry" (wrangler.jsonc production value).
 */

import { MongoClient } from "mongodb";
import { INDEX_SPEC, EXPECTED_COLLECTIONS } from "../src/db/indexes.ts";

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("ERROR: MONGO_URI environment variable is required");
  process.exit(1);
}
const dbName = process.env.MONGO_DB_NAME ?? "fpmregistry";

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
});

try {
  await client.connect();
  console.log(`Connected. Bootstrapping database "${dbName}"...`);
  const db = client.db(dbName);

  // 1. Collections
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of EXPECTED_COLLECTIONS) {
    if (existing.has(name)) {
      console.log(`  collection "${name}": exists`);
    } else {
      await db.createCollection(name);
      console.log(`  collection "${name}": created`);
    }
  }

  // 2. Indexes
  let total = 0;
  for (const entry of INDEX_SPEC) {
    const created = await db
      .collection(entry.collection)
      .createIndexes(entry.indexes as Parameters<ReturnType<typeof db.collection>["createIndexes"]>[0]);
    total += created.length;
    console.log(`  indexes on "${entry.collection}": ${created.length} applied (${created.join(", ")})`);
  }

  console.log(`Done. ${total} indexes ensured across ${INDEX_SPEC.length} collections.`);
} finally {
  await client.close();
}
