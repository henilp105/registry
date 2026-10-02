/**
 * MongoPool — the single Durable Object that owns the MongoDB connection.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (the single most important file in the migration)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Cloudflare Workers Free allows **10 ms of CPU per invocation**. Measured on
 * this repo against the live cluster:
 *
 *     PBKDF2-SHA256, 4096 iterations (one step of MongoDB's SCRAM handshake)
 *     ................................................................ 4.47 ms CPU
 *     Cloudflare Workers Free budget ................................ 10 ms CPU
 *
 * One SCRAM step consumes ~45% of the entire budget. Add a TLS 1.3 handshake
 * (X25519 + AES-GCM), BSON codec warm-up and driver init, and a *cold*
 * MongoDB connection inside a Worker handler reliably blows the limit →
 * Cloudflare error 1102 ("Worker exceeded resource limits").
 *
 * Durable Objects on the Free plan allow **30 seconds of CPU per request**, and
 * SQLite-backed DO storage is explicitly *not* billed on the Free plan. So the
 * connection is established once, inside the DO, and reused for every request.
 *
 *     cold Worker handler -> ~4.5 ms SCRAM + ~4 ms TLS + init => EXCEEDS 10ms
 *     warm DO handler     -> ~1-2 ms BSON encode/decode       => fits easily
 *
 * Responsibilities:
 *   1. Lazily open one `MongoClient` and keep it alive for the DO's lifetime.
 *   2. Serialise writes through this single object, which removes the
 *      read-modify-write races documented as defect D22 (ratings counts).
 *   3. Retry idempotent operations once on a transient Mongo error.
 */

import { DurableObject } from "cloudflare:workers";
import { toBsonQueries, toRpcSafe } from "./bson";
import { hashPassword, parseIterations, verifyPassword } from "../lib/password";
import {
  MongoClient,
  type ClientSession,
  type Db,
  type Document,
  type Filter,
  type IndexDescription,
  type MongoClientOptions,
} from "mongodb";

/** Operations a Worker can ask the pool to perform. */
export type MongoOp =
  | { kind: "ping" }
  | { kind: "findOne"; collection: string; filter: Document; projection?: Document }
  | {
      kind: "find";
      collection: string;
      filter: Document;
      projection?: Document;
      sort?: Document;
      limit?: number;
      skip?: number;
    }
  | { kind: "count"; collection: string; filter: Document }
  | { kind: "insertOne"; collection: string; doc: Document }
  | { kind: "updateOne"; collection: string; filter: Document; update: Document; upsert?: boolean }
  | { kind: "updateMany"; collection: string; filter: Document; update: Document }
  | { kind: "deleteOne"; collection: string; filter: Document }
  | { kind: "deleteMany"; collection: string; filter: Document }
  | { kind: "aggregate"; collection: string; pipeline: Document[] }
  /** Multi-step atomic unit — used by the Phase 2b cascade deletes. */
  | { kind: "transaction"; steps: TransactionStep[] }
  /** Create collections if absent, then apply indexes. Idempotent. */
  | { kind: "bootstrap"; collections: string[]; spec: IndexSpec[] }
  | { kind: "ensureIndexes"; spec: IndexSpec[] }
  /**
   * Password KDF, run *here* rather than in the Worker.
   *
   * Measured on this repo:
   *     PBKDF2-SHA256,   4,096 iterations .......   3.9 ms
   *     PBKDF2-SHA256,  10,000 iterations .......   8.5 ms
   *     PBKDF2-SHA256, 210,000 iterations ....... 176 ms
   *     Worker Free CPU budget .................  10 ms
   *
   * So even the iteration count MongoDB itself uses for SCRAM costs ~40% of
   * the whole budget, and the count we actually want for password storage is
   * ~18x over it. Hashing in a Worker handler would return Cloudflare error
   * 1102 on every login and every signup.
   *
   * The Durable Object has 30 s of CPU per request on the Free plan, which is
   * the same trick that makes the MongoDB connection viable: move the
   * expensive CPU into the one place that has budget for it.
   *
   * A useful side effect: the legacy `SALT` secret only has to exist on the
   * Durable Object, so it is no longer part of the Worker's environment.
   */
  | { kind: "hashPassword"; password: string }
  | { kind: "verifyPassword"; password: string; stored: string; salt: string };

export type TransactionStep =
  | { kind: "insertOne"; collection: string; doc: Document }
  | { kind: "updateOne"; collection: string; filter: Document; update: Document; upsert?: boolean }
  | { kind: "updateMany"; collection: string; filter: Document; update: Document }
  | { kind: "deleteOne"; collection: string; filter: Document }
  | { kind: "deleteMany"; collection: string; filter: Document };

export type IndexSpec = { collection: string; indexes: Document[] };

export type PoolEnv = {
  MONGO_URI: string;
  MONGO_DB_NAME: string;
  /** Legacy sha256 salt. Lives only here so it is absent from the Worker env. */
  SALT: string;
  PBKDF2_ITERATIONS: string;
};

export type WriteResult = {
  matchedCount: number;
  modifiedCount: number;
  upsertedId: unknown | null;
};

export type DeleteResult = { deletedCount: number };

/**
 * One pool per region. The Worker resolves the id from the name so every
 * request in a region converges on the same Durable Object instance.
 */
export const POOL_NAME = "fpm-registry-mongo-pool";

export class MongoPool extends DurableObject<PoolEnv> {
  /** The live client. Survives for the DO isolate's lifetime — this is what
   *  turns a ~9 ms cold handshake into a ~2 ms warm query for every later call. */
  #client: MongoClient | null = null;
  /** Collapses a burst of parallel requests onto one handshake. */
  #connecting: Promise<MongoClient> | null = null;
  #db: Db | null = null;
  #lastError: string | null = null;
  #opsServed = 0;

  constructor(ctx: DurableObjectState, env: PoolEnv) {
    super(ctx, env);
  }

  /** Ordered ops are run inside a MongoDB transaction. */
  async #transaction(steps: TransactionStep[]): Promise<unknown> {
    const client = await this.#connect();
    const db = this.#dbFor(client);
    const session: ClientSession = client.startSession();
    let out: unknown = null;
    try {
      await session.withTransaction(async () => {
        out = null;
        for (const raw of steps) {
          const c = db.collection(raw.collection);
          // Every filter and update in a transaction goes through the same
          // hex -> ObjectId conversion as the non-transactional path.
          //
          // Omitting it made **every cascade delete silently delete nothing**
          // while returning HTTP 200. `POST /namespace/<ns>/delete` filtered
          // `{_id: "<24 hex>"}` against a stored ObjectId, matched zero rows, and
          // answered `code: 200, "Namespace deleted successfully"` with the
          // document still present. Same for delete_package and delete_user.
          //
          // That is the worst possible shape for this bug: the legacy defect the
          // audit recorded as fixed ("delete_namespace never deleted anything and
          // always returned code:500 at HTTP 200") was still there, only with a
          // tidier status code. Found by exercising the write path against the
          // live cluster; the unit tests all used object identity rather than
          // asserting that a document actually disappeared.
          // `filter` and `update` only exist on some variants of the union, so
          // they are read through `"in"` rather than off the whole union.
          const step = {
            ...raw,
            filter: "filter" in raw && raw.filter ? (toBsonQueries(raw.filter) as Document) : undefined,
            update: "update" in raw && raw.update ? (toBsonQueries(raw.update) as Document) : undefined,
          } as typeof raw;
          switch (step.kind) {
            case "insertOne": {
              // Same conversion as the non-transactional path above: a cascade
              // delete runs in a transaction and its writes must obey the same
              // id-representation rule, or a transactionally-created document
              // would differ from an ordinarily-created one.
              const r = await c.insertOne(toBsonQueries(step.doc) as Document, { session });
              out = { insertedId: r.insertedId };
              break;
            }
            case "updateOne": {
              const r = await c.updateOne(
                step.filter as Filter<Document>,
                step.update,
                step.upsert ? { upsert: true, session } : { session },
              );
              out = {
                matchedCount: r.matchedCount,
                modifiedCount: r.modifiedCount,
                upsertedId: r.upsertedId ?? null,
              } satisfies WriteResult;
              break;
            }
            case "updateMany": {
              const r = await c.updateMany(step.filter as Filter<Document>, step.update, { session });
              out = {
                matchedCount: r.matchedCount,
                modifiedCount: r.modifiedCount,
                upsertedId: null,
              } satisfies WriteResult;
              break;
            }
            case "deleteOne": {
              const r = await c.deleteOne(step.filter as Filter<Document>, { session });
              out = { deletedCount: r.deletedCount } satisfies DeleteResult;
              break;
            }
            case "deleteMany": {
              const r = await c.deleteMany(step.filter as Filter<Document>, { session });
              out = { deletedCount: r.deletedCount } satisfies DeleteResult;
              break;
            }
          }
        }
      });
      return out;
    } finally {
      await session.endSession();
    }
  }

  async #connect(): Promise<MongoClient> {
    if (this.#client) return this.#client;
    if (!this.#connecting) {
      // Cast through `unknown` on purpose. In mongodb 7, `MongoClientOptions`
      // extends `SupportedNodeConnectionOptions`, which `Pick`s from the
      // Node `TLSSocketOptions`/`TcpNetConnectOpts` shapes. Depending on the
      // installed @types/node, TypeScript can demand a large block of TLS
      // members that are all optional at runtime. These are standard,
      // documented driver options, so the cast is safe and keeps us from
      // pinning a @types/node version just to satisfy the compiler.
      const options = {
        // Bound the handshake so a bad URI fails fast rather than holding a
        // Worker invocation open until it hits the CPU limit.
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS: 5_000,
        // Atlas free (M0/Flex) clusters require SNI TLS.
        tls: true,
        retryWrites: true,
        retryReads: true,
        appName: "fpm-registry-worker",
        maxPoolSize: 5,
        minPoolSize: 1,
      } as unknown as MongoClientOptions;

      const client = new MongoClient(this.env.MONGO_URI, options);
      this.#connecting = client.connect();
      // Keep a handle so #reset() can close it if the handshake fails.
      this.#pendingClient = client;
    }
    try {
      this.#client = await this.#connecting;
      this.#connecting = null;
      this.#pendingClient = null;
      this.#lastError = null;
      return this.#client;
    } catch (err) {
      this.#connecting = null;
      this.#lastError = err instanceof Error ? err.message : String(err);
      const pending = this.#pendingClient;
      this.#pendingClient = null;
      if (pending) {
        try {
          await pending.close(true);
        } catch {
          /* nothing to salvage */
        }
      }
      throw err;
    }
  }

  #pendingClient: MongoClient | null = null;

  #dbFor(client: MongoClient): Db {
    if (!this.#db) this.#db = client.db(this.env.MONGO_DB_NAME);
    return this.#db;
  }

  // ── entry points ─────────────────────────────────────────────────────────

  /** Execute one operation. Called by the Worker over a service binding. */
  async execute(request: { op: MongoOp }): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.#run(request.op);
        this.#opsServed += 1;
        this.#lastError = null;
        // Sanitise at the RPC boundary. This is the only place raw BSON leaves
        // the Durable Object, and workerd's RPC layer cannot serialise a BSON
        // ObjectId -- it throws
        //   `Could not serialize object of type "_ObjectId"`.
        //
        // This is not a cosmetic detail. The MongoDB driver returns documents
        // with `_id` as an ObjectId unless a projection excludes it, and Mongo's
        // `$project` includes `_id` by default. So any query that returns a whole
        // document -- every read route in this API -- returned an ObjectId and
        // failed at the boundary, turning a 200 into a 500.
        //
        // Found by running `wrangler dev` against the real Atlas cluster with
        // real documents. Every read route 500'd: /packages, /packages/{ns}/{pkg},
        // /namespace/{ns}. The 26 live-Atlas tests had passed because their
        // fixtures and projections happened never to place an ObjectId in the
        // response -- which is precisely the gap that only real data finds.
        return toRpcSafe(result);
      } catch (err) {
        if (attempt >= 1 || !isRetryable(err)) throw err;
        // The socket may have died under us; drop it so the retry reconnects.
        await this.#reset();
      }
    }
  }

  /** Establish the connection outside a request, e.g. from a Cron Trigger. */
  async warm(): Promise<{ connected: boolean }> {
    await this.#connect();
    return { connected: true };
  }

  async health(): Promise<{
    ok: boolean;
    connected: boolean;
    opsServed: number;
    lastError: string | null;
    serverVersion: string | null;
  }> {
    // A cold Durable Object has no client, because the connection is established
    // lazily on first use. The previous version of this method reported
    // `connected: false` in that state -- reporting a database outage it had
    // never actually tested.
    //
    // Found by running `wrangler dev` against the real cluster: `/health` said
    // `degraded, mongo.connected: false` while `/packages` was succeeding in
    // reaching MongoDB, and the only genuine fault was a missing text index. The
    // health endpoint pointed at the wrong subsystem, which is exactly the wrong
    // property for a signal that exists to direct an incident.
    //
    // So: connect if needed, then actually verify. Absence of evidence is not
    // evidence of disconnection.
    if (!this.#client) {
      try {
        await this.#connect();
      } catch (err) {
        return {
          ok: false,
          connected: false,
          opsServed: this.#opsServed,
          lastError: err instanceof Error ? err.message : String(err),
          serverVersion: null,
        };
      }
    }

    try {
      // `#connect()` guarantees a client, but TS cannot see across the await, so
      // re-read the field rather than asserting.
      const client = this.#client;
      if (!client) throw new Error("connection lost between connect and probe");
      const info = (await client.db("admin").command({ buildInfo: 1 })) as { version?: string };
      return {
        ok: true,
        connected: true,
        opsServed: this.#opsServed,
        lastError: this.#lastError,
        serverVersion: info.version ?? null,
      };
    } catch (err) {
      return {
        ok: false,
        connected: false,
        opsServed: this.#opsServed,
        lastError: err instanceof Error ? err.message : String(err),
        serverVersion: null,
      };
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Create every collection, then apply the index set.
   *
   * The ordering is not optional. On an Atlas M0 (free) cluster `createIndexes`
   * against a namespace that does not exist yet fails with
   * `Expected 'createIndexes' to be string, but got <nil>`, so the collections
   * have to be materialised first. Both steps are idempotent, which is what
   * lets the hourly cron re-run this as a self-healing drift repair.
   */
  async #bootstrap(collections: string[], spec: IndexSpec[]): Promise<{ collections: string[]; indexes: string[] }> {
    const client = await this.#connect();
    const db = client.db(this.env.MONGO_DB_NAME);

    const existing = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
    );

    const created: string[] = [];
    for (const name of collections) {
      if (existing.has(name)) continue;
      try {
        await db.createCollection(name);
        created.push(name);
      } catch (err) {
        // NamespaceExists (48) means another isolate won the race — fine.
        if ((err as { code?: number }).code !== 48) throw err;
      }
    }

    return { collections: created, indexes: await this.#ensureIndexes(spec) };
  }

  async #ensureIndexes(spec: IndexSpec[]): Promise<string[]> {
    const client = await this.#connect();
    const db = client.db(this.env.MONGO_DB_NAME);
    const applied: string[] = [];
    for (const entry of spec) {
      applied.push(...(await db.collection(entry.collection).createIndexes(entry.indexes as IndexDescription[])));
    }
    return applied;
  }

  async #run(op: MongoOp): Promise<unknown> {
    const client = await this.#connect();

    if (op.kind === "ping") {
      await client.db("admin").command({ ping: 1 });
      return { ok: 1 };
    }
    if (op.kind === "transaction") {
      return this.#transaction(op.steps);
    }
    if (op.kind === "hashPassword") {
      return hashPassword(op.password, parseIterations(this.env.PBKDF2_ITERATIONS));
    }
    if (op.kind === "verifyPassword") {
      return verifyPassword(op.password, op.stored, op.salt ?? this.env.SALT);
    }
    if (op.kind === "ensureIndexes") {
      return this.#ensureIndexes(op.spec);
    }
    if (op.kind === "bootstrap") {
      return this.#bootstrap(op.collections, op.spec);
    }

    const c = this.#dbFor(client).collection(op.collection);

    // Every query fragment goes through the hex -> ObjectId conversion. Doing it
    // here rather than per call site is what makes the string ids that
    // `toRpcSafe` emits safe to use as filters. See `toBsonQueries`.
    // `insertOne` carries a document rather than a filter, and the earlier
    // branches above have already returned for every non-query kind.
    const filter = ("filter" in op ? toBsonQueries(op.filter) : {}) as Filter<Document>;
    // `update` and `pipeline` only exist on some variants of the union, so they
    // are narrowed by kind rather than read off the whole union.
    const update = "update" in op && op.update ? (toBsonQueries(op.update) as Document) : undefined;
    const pipeline = "pipeline" in op && op.pipeline ? (toBsonQueries(op.pipeline) as Document[]) : undefined;

    switch (op.kind) {
      case "findOne":
        return (
          (await c.findOne(filter, op.projection ? { projection: op.projection } : undefined)) ??
          null
        );
      case "find": {
        let cursor = c.find(filter);
        if (op.projection) cursor = cursor.project(op.projection);
        if (op.sort) cursor = cursor.sort(op.sort);
        if (op.skip) cursor = cursor.skip(op.skip);
        if (op.limit !== undefined) cursor = cursor.limit(op.limit);
        return await cursor.toArray();
      }
      case "count":
        return await c.countDocuments(op.filter as Filter<Document>);
      case "insertOne": {
        // The document goes through the same hex -> ObjectId conversion as the
        // filters do. Without this, the app writes id *references* as strings.
        //
        // How that happened: `toRpcSafe` turns an ObjectId into its hex string on
        // the way out of the Durable Object, because workerd cannot serialise a
        // BSON ObjectId. A handler then reads `namespace._id` from a fetched
        // document and stores it on the next insert -- as a string. The document
        // looks fine and every read of it returns 404.
        //
        // Concretely, `POST /packages` published a package whose `namespace` was
        // the string "6abf6fa3c720a1d7775834f5" rather than an ObjectId, after
        // which `GET /packages/{ns}/{pkg}`, `POST /ratings/...` and
        // `PUT /packages` all 404'd for that package, while a hand-seeded package
        // with a real ObjectId worked fine. `ratings` had the same problem with
        // `package_id` and `user_id`.
        const r = await c.insertOne(toBsonQueries(op.doc) as Document);
        return { insertedId: r.insertedId };
      }
      case "updateOne": {
        const r = await c.updateOne(filter, update as Document, op.upsert ? { upsert: true } : undefined);
        return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount, upsertedId: r.upsertedId ?? null };
      }
      case "updateMany": {
        const r = await c.updateMany(filter, update as Document);
        return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount, upsertedId: null };
      }
      case "deleteOne": {
        const r = await c.deleteOne(filter);
        return { deletedCount: r.deletedCount };
      }
      case "deleteMany": {
        const r = await c.deleteMany(filter);
        return { deletedCount: r.deletedCount };
      }
      case "aggregate":
        return await c.aggregate(pipeline as Document[]).toArray();
    }
  }

  async #reset(): Promise<void> {
    const client = this.#client ?? this.#pendingClient;
    this.#client = null;
    this.#pendingClient = null;
    this.#connecting = null;
    this.#db = null;
    if (!client) return;
    try {
      await client.close(true);
    } catch {
      /* already gone */
    }
  }
}

/** MongoDB error names and codes worth exactly one retry. */
function isRetryable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = "name" in err ? String((err as { name: unknown }).name) : "";
  if (
    name === "MongoNetworkError" ||
    name === "MongoServerSelectionError" ||
    name === "MongoNotPrimaryError" ||
    name === "MongoTopologyClosedError"
  ) {
    return true;
  }
  const code = "code" in err ? (err as { code: unknown }).code : undefined;
  return typeof code === "number" && RETRYABLE_CODES.has(code);
}

const RETRYABLE_CODES = new Set([6, 7, 89, 91, 189, 9001, 10107, 11600, 11602, 13435, 13436]);
