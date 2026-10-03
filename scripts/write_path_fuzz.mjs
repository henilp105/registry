#!/usr/bin/env node
// ESM has no `require`, but the credential helper is CommonJS so that the .cjs
// harnesses can share it. `createRequire` is the bridge.
import { createRequire } from "node:module";
const { mongoUri, mongoDbName } = createRequire(import.meta.url)("./_env.cjs");
/**
 * Adversarial and concurrency probes for the upload and rating paths.
 *
 *   node scripts/write_path_fuzz.mjs [API_BASE]
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `write_path_audit.mjs` exercises the write surface with well-formed input and
 * one user. Two things remain untested, and both are where a free-tier public API
 * actually breaks:
 *
 *   1. **Hostile input.** The upload path accepts a 50 MB artifact from an
 *      unauthenticated-in-spirit caller holding only a publish token, writes it to
 *      R2, and records a digest. Every validation on that path is a control that
 *      either holds or doesn't.
 *   2. **Concurrency.** Everything funnels through one Durable Object, which the
 *      runtime serialises -- so races are subtler than they look, not absent.
 *      `v0.0.1` had documented read-modify-write counters that lost votes, and the
 *      migration claims to have fixed that. Claims about races need testing, not
 *      reasoning.
 *
 * Asserts on the response *and* on database state, for the reason recorded in
 * D55: an endpoint that answers 200 while doing nothing passes a status check.
 */

import { MongoClient } from "mongodb";

const API = process.argv[2] ?? "http://127.0.0.1:8787";
const URI = mongoUri("write_path_fuzz.mjs");
// Defect D120 class: the DB name must follow MONGO_DB_NAME, the same
// variable the Worker reads, or every assertion reads the wrong database.
const DB = mongoDbName();

let passed = 0;
const failures = [];
const ok = (n, d = "") => { passed++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { failures.push({ n, d }); console.log(`  FAIL  ${n} — ${d}`); };
const check = (n, c, d = "") => (c ? ok(n, d) : bad(n, d || "assertion failed"));

const form = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) f.append(k, String(v));
  return f;
};

/**
 * Addresses for synthetic clients.
 *
 * Every account this harness creates signs up **anonymously**, and anonymous
 * callers are keyed on their address. Eight publishers sharing one address would
 * make eight signups against a documented budget of **10 per minute** for auth,
 * which the limiter would correctly refuse -- leaving the harness unable to
 * verify anything it was built to verify.
 *
 * So each synthetic client gets its own address, which is what a real CI fleet
 * looks like. Note this is not a workaround: rate limiting per address for
 * anonymous traffic is the documented behaviour, and it behaving that way is the
 * thing being relied on.
 */
let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `198.19.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};
const RUN_IP = nextIp();

async function post(path, { f, bearer, ip } = {}) {
  const init = { method: "POST", headers: { "cf-connecting-ip": ip ?? RUN_IP } };
  if (bearer) init.headers.Authorization = `Bearer ${bearer}`;
  if (f) init.body = f;
  const r = await fetch(API + path, init);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* not JSON */ }
  return { status: r.status, json: j, text: t };
}

const gz = async (bytes) =>
  new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
  );

const uploadForm = (token, name, version, extra = {}) => {
  const f = form({
    upload_token: token, package_name: name, package_version: version,
    package_license: "MIT", ...extra,
  });
  f.append("tarball", new Blob([new Uint8Array([1, 2, 3])], { type: "application/gzip" }), "a.tar.gz");
  return f;
};

(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB);

  const stamp = Date.now().toString(36);
  const user = `fuzz_${stamp}`;
  const NS = `fz${stamp.toLowerCase()}`;

  // A publish token, and an authenticated session for the rating probes.
  const bootstrap = await post("/auth/signup", {
    f: form({ username: user, email: `${user}@example.invalid`, password: "fuzz-password-1234" }),
  });
  check("bootstrap signup", bootstrap.status === 200, `got ${bootstrap.status}`);
  await db.collection("users").updateOne({ username: user }, { $set: { isVerified: true } });
  const login = await post("/auth/login", {
    f: form({ user_identifier: user, password: "fuzz-password-1234" }),
  });
  const bearer = login.json?.access_token ?? login.json?.accessToken;
  check("bootstrap login", typeof bearer === "string");
  await post("/namespaces", { f: form({ namespace: NS, namespace_description: "fuzz" }), bearer });
  const tk = await post(`/namespaces/${NS}/uploadToken`, { bearer });
  const token = tk.json?.upload_token ?? tk.json?.uploadToken;
  check("bootstrap publish token", typeof token === "string");

  /**
   * A pool of independent publishers, round-robined for upload probes.
   *
   * The documented upload budget is **5 per hour per client**, and this harness
   * issues ~28 uploads. Concentrated on one identity it would be refused by the
   * limiter after five — which is the limiter working correctly and the harness
   * measuring nothing.
   *
   * Spreading across several accounts is what a real CI fleet does, and it makes
   * the concurrency probes *more* faithful rather than less: the unique-index race
   * in D59 is global, not per client, so five racing publishes from five distinct
   * identities still collide on `packages_name_namespace_unique` exactly as they
   * would from one runner.
   */
  const publisherPool = async (size) => {
    const pool = [];
    for (let i = 0; i < size; i++) {
      const u = `pub${i}_${stamp}`;
      const ns = `pz${i}${stamp.toLowerCase()}`;
      const ip = nextIp();
      await post("/auth/signup", {
        f: form({ username: u, email: `${u}@example.invalid`, password: "publisher-password-1" }),
        ip,
      });
      await db.collection("users").updateOne({ username: u }, { $set: { isVerified: true } });
      const l = await post("/auth/login", {
        f: form({ user_identifier: u, password: "publisher-password-1" }), ip,
      });
      const b = l.json?.access_token ?? l.json?.accessToken;
      await post("/namespaces", {
        f: form({ namespace: ns, namespace_description: "pool" }), bearer: b, ip,
      });
      const t = await post(`/namespaces/${ns}/uploadToken`, { bearer: b, ip });
      pool.push({ username: u, namespace: ns, bearer: b, ip, token: t.json?.upload_token ?? t.json?.uploadToken });
    }
    return pool;
  };

  const countPkg = async (name) =>
    db.collection("packages").countDocuments({ name, namespace_name: NS });
  const pkgId = async (name) =>
    (await db.collection("packages").findOne({ name, namespace_name: NS }))?._id;

  // ── hostile input ──────────────────────────────────────────────────────────
  console.log("\n[hostile input: upload]");
  const hostile = [
    ["name with a slash (path traversal)", "a/b", "1.0.0"],
    ["name with ..", "..", "1.0.0"],
    ["name with a null byte", "a\u0000b", "1.0.0"],
    ["empty name", "", "1.0.0"],
    ["65-character name (over the limit)", "x".repeat(65), "1.0.0"],
    ["name with spaces", "a b", "1.0.0"],
    ["name with a shell metacharacter", "a;rm -rf /", "1.0.0"],
    ["version 0.0.0 (explicitly rejected)", "ok", "0.0.0"],
    ["non-semver version", "ok2", "not-a-version"],
    ["version with a slash", "ok3", "1.0.0/../../x"],
    ["empty version", "ok4", ""],
    ["empty license", "ok5", "1.0.0"],
  ];

  const POOL_SIZE = 8;
  const pool = await publisherPool(POOL_SIZE);
  check("publisher pool created", pool.every((x) => typeof x.token === "string"),
    `${pool.length} publishers`);
  let poolIndex = 0;
  const nextPublisher = () => pool[poolIndex++ % pool.length];

  for (const [label, name, version] of hostile) {
    const license = label.startsWith("empty license") ? "" : "MIT";
    const f = form({
      upload_token: nextPublisher().token, package_name: name, package_version: version, package_license: license,
    });
    f.append("tarball", new Blob([await gz("{}")], { type: "application/gzip" }), "a.tar.gz");
    const res = await post("/packages", { f, ip: nextIp() });
    const stored = name && version ? await countPkg(name) : 0;
    check(
      `rejects ${label}`,
      res.status >= 400 && stored === 0,
      `status=${res.status} stored=${stored}`,
    );
  }

  // A missing tarball must not create anything.
  const noTarball = await post("/packages", {
    f: form({ upload_token: token, package_name: "notarball", package_version: "1.0.0", package_license: "MIT" }),
  });
  check("rejects a missing tarball", noTarball.status >= 400 && (await countPkg("notarball")) === 0,
    `status=${noTarball.status}`);

  // An oversized artifact. MAX_TARBALL_BYTES is 50 MB; this sends just over it.
  const oversize = new Uint8Array(50 * 1024 * 1024 + 1024);
  const bigForm = form({ upload_token: nextPublisher().token, package_name: "toobig", package_version: "1.0.0", package_license: "MIT" });
  bigForm.append("tarball", new Blob([oversize], { type: "application/gzip" }), "big.tar.gz");
  const bigRes = await post("/packages", { f: bigForm, ip: nextIp() });
  check("rejects an oversized artifact", bigRes.status === 413 && (await countPkg("toobig")) === 0,
    `status=${bigRes.status}`);

  // An unauthenticated publish attempt: no token at all.
  const noTokenForm = form({ package_name: "notoken", package_version: "1.0.0", package_license: "MIT" });
  noTokenForm.append("tarball", new Blob([await gz("{}")], { type: "application/gzip" }), "a.tar.gz");
  const noToken = await post("/packages", { f: noTokenForm });
  check("rejects a publish with no token", noToken.status >= 400 && (await countPkg("notoken")) === 0,
    `status=${noToken.status}`);

  // ── injection-shaped search ────────────────────────────────────────────────
  console.log("\n[hostile input: search]");
  for (const q of [
    '"; dropDatabase(); //',
    ".*",
    "^",
    "\\",
    '{"$ne": null}',
    "a".repeat(600),
    "<script>alert(1)</script>",
    "%00",
  ]) {
    const url = `/packages?query=${encodeURIComponent(q)}`;
    const r = await fetch(API + url);
    const body = await r.text();
    check(
      `search survives ${JSON.stringify(q.slice(0, 24))}`,
      r.status === 200 || r.status === 400,
      `status=${r.status}`,
    );
    check("  the database is still there", (await db.listCollections().toArray()).length > 0);
  }

  // ── concurrency: simultaneous publishes of the same version ────────────────
  console.log("\n[concurrency: same version, 8 parallel publishes]");
  const RACE_PKG = "racepkg";
  // The *bootstrap* token, which is scoped to `NS`, spread across distinct
  // addresses.
  //
  // Using a pool publisher's token here would target that publisher's own
  // namespace rather than `NS` -- a publish token is scoped, so the request's
  // namespace is not what decides where the package lands. The unique-index race
  // under test is on `(name, namespace)`, so the addresses only need to differ to
  // stay under the per-client upload budget; they need not be different accounts.
  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      post("/packages", { f: uploadForm(token, RACE_PKG, "1.0.0"), ip: nextIp() }),
    ),
  );
  const succeeded = attempts.filter((a) => a.status === 200).length;
  const raceDoc = await db.collection("packages").findOne({ name: RACE_PKG, namespace_name: NS });
  const raceVersions = (raceDoc?.versions ?? []).filter((v) => v.version === "1.0.0");
  check("exactly one version document exists after 8 racing publishes",
    raceVersions.length === 1, `${raceVersions.length} copies`);
  check("the racing losers are told the version exists, not silently accepted",
    attempts.every((a) => a.status === 200 || (a.status === 400 && /already exists/.test(a.json?.message ?? ""))),
    attempts.map((a) => a.status).join(","));
  check("no duplicate package document",
    (await countPkg(RACE_PKG)) === 1, `${await countPkg(RACE_PKG)}`);
  check("at least one publish of the same version succeeded", succeeded >= 1,
    `${succeeded}/${pool.length} returned 200`);
  // Exactly one wins; every other request must be told the version exists rather
  // than silently accepted or failed for some unrelated reason.
  const duplicates = attempts.filter(
    (a) => a.status === 400 && /already exists/i.test(a.json?.message ?? ""),
  );
  check("every duplicate publish was told the version exists",
    succeeded === 1 && duplicates.length === attempts.length - 1,
    `${succeeded} accepted, ${duplicates.length} told "already exists", of ${attempts.length}`);
  check("no duplicate publish failed for an unrelated reason",
    attempts.every((a) => a.status === 200 || a.status === 400),
    attempts.map((a) => `${a.status}:${a.json?.message ?? ""}`).join(" | ").slice(0, 160));
  check("the namespace references the package once",
    (((await db.collection("namespaces").findOne({ namespace: NS }))?.packages ?? [])
      .filter((p) => String(p) === String(raceDoc?._id))).length === 1,
    "exactly one reference");

  // ── concurrency: simultaneous different versions ───────────────────────────
  console.log("\n[concurrency: 5 different versions in parallel]");
  const VERS = "verspkg";
  const versAttempts = await Promise.all(
    ["1.0.0", "1.0.1", "1.0.2", "1.1.0", "2.0.0"].map((v) =>
      post("/packages", { f: uploadForm(token, VERS, v), ip: nextIp() }),
    ),
  );
  check("every racing publish was accepted", versAttempts.every((a) => a.status === 200),
    versAttempts.map((a) => a.status).join(","));
  const versDoc = await db.collection("packages").findOne({ name: VERS, namespace_name: NS });
  const seen = (versDoc?.versions ?? []).map((v) => v.version);
  check("every racing version was recorded exactly once",
    seen.length === 5 && new Set(seen).size === 5, `versions=${JSON.stringify(seen)}`);
  check("latest is the highest by semver",
    (await (await fetch(`${API}/packages/${NS}/${VERS}`)).json())?.data?.latest_version_data?.version === "2.0.0");

  // ── concurrency: simultaneous ratings ──────────────────────────────────────
  console.log("\n[concurrency: 10 simultaneous ratings, same user]");
  // Ten distinct accounts, so this tests aggregation under contention rather
  // than one user overwriting their own vote ten times.
  const voters = [];
  for (let i = 0; i < 10; i++) {
    const u = `voter${i}_${stamp}`;
    const ip = nextIp();
    await post("/auth/signup", {
      f: form({ username: u, email: `${u}@example.invalid`, password: "voter-password-1" }), ip,
    });
    await db.collection("users").updateOne({ username: u }, { $set: { isVerified: true } });
    const l = await post("/auth/login", {
      f: form({ user_identifier: u, password: "voter-password-1" }), ip,
    });
    voters.push(l.json?.access_token ?? l.json?.accessToken);
  }
  const rated = await Promise.all(
    voters.map((b, i) => post(`/ratings/${NS}/${RACE_PKG}`, { f: form({ rating: (i % 5) + 1 }), bearer: b })),
  );
  const ratedOk = rated.filter((r) => r.status === 200).length;
  check("every concurrent rating was accepted", ratedOk === 10, `${ratedOk}/10`);
  const ratedDoc = await db.collection("packages").findOne({ name: RACE_PKG, namespace_name: NS });
  const userKeys = Object.keys(ratedDoc?.ratings?.users ?? {});
  check("all 10 votes are stored, none lost to a read-modify-write race",
    userKeys.length === 10, `${userKeys.length} recorded`);
  const readBack = await (await fetch(`${API}/packages/${NS}/${RACE_PKG}`)).json();
  check("the read pipeline derives a rating from those votes",
    readBack?.data?.ratings !== null && readBack?.data?.ratings !== undefined,
    `ratings=${JSON.stringify(readBack?.data?.ratings)}`);
  check("ratings is a number, not a one-element array (D21)",
    typeof readBack?.data?.ratings === "number", `typeof ${typeof readBack?.data?.ratings}`);

  // ── concurrency: simultaneous duplicate namespace creation ─────────────────
  console.log("\n[concurrency: 5 identical namespace creations]");
  const DUPNS = `dup${stamp.toLowerCase()}`;
  const created = await Promise.all(
    Array.from({ length: 5 }, () =>
      post("/namespaces", { f: form({ namespace: DUPNS, namespace_description: "dup" }), bearer }),
    ),
  );
  const createdOk = created.filter((c) => c.status === 200).length;
  const dupCount = await db.collection("namespaces").countDocuments({ namespace: DUPNS });
  check("at most one namespace document exists", dupCount === 1, `${dupCount} documents`);
  check("the losers were refused, not silently accepted", createdOk <= 1, `${createdOk} returned 200`);

  // ── cleanup ────────────────────────────────────────────────────────────────
  await db.collection("users").deleteMany({
    username: { $in: [user, ...voters.map((_, i) => `voter${i}_${stamp}`), ...pool.map((x) => x.username)] },
  });
  await db.collection("namespaces").deleteMany({
    namespace: { $in: [NS, DUPNS, ...pool.map((x) => x.namespace)] },
  });
  await db.collection("packages").deleteMany({ namespace_name: { $in: [NS, DUPNS] } });
  await client.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ${f.n}: ${f.d}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
