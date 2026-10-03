#!/usr/bin/env node
const { MongoClient } = require("mongodb");
const { mongoUri, mongoDbName } = require("./_env.cjs");
/**
 * Does the rate limiter actually refuse anything?
 *
 *   node scripts/rate_limit_probe.cjs [API_BASE]
 *
 * A limiter that emits headers but never returns 429 is worse than none, because
 * the headers then promise a protection that does not exist — which is precisely
 * the state defect D41 recorded: the documentation promised `X-RateLimit-*` and a
 * 429 handler existed that nothing raised.
 */

// Defect D119: the header documents `node scripts/rate_limit_probe.cjs
// [API_BASE]`, but `process.argv[2]` was never read -- `API` was a constant. An
// operator pointed it at a deployed registry, believed they were probing the
// target, and had actually been probing their own laptop. Now honoured, with a
// line printed so the log says which host was measured.
const API = process.argv[2] ?? "http://127.0.0.1:8787";
const URI = mongoUri("rate_limit_probe.cjs");

let passed = 0;
const failures = [];
const ok = (n, d = "") => { passed++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { failures.push({ n, d }); console.log(`  FAIL  ${n} — ${d}`); };
const check = (n, c, d = "") => (c ? ok(n, d) : bad(n, d || "assertion failed"));

const form = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, String(v));
  return f;
};

async function hit(path, { method = "GET", f, bearer, ip } = {}) {
  const headers = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (ip) headers["cf-connecting-ip"] = ip;
  const r = await fetch(API + path, { method, headers, body: f });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, h: r.headers };
}

(async () => {
  const c = new MongoClient(URI);
  await c.connect();
    // Defect D120: hardcoded "fpmregistry_local" instead of `mongoDbName()`.
  // `MONGO_DB_NAME` is the variable the Worker itself reads and the one
  // .github/workflows/tests.yml sets, so with it set to anything else this
  // harness read a database the API under test was not writing to -- or
  // failed with "registration did not create ..." while the run was fine.
  // Four harnesses now resolve the name the same way member_journey.cjs
  // already did.
const db = c.db(mongoDbName());

  const stamp = Date.now().toString(36);
  console.log(`\nrate-limit enforcement against ${API}\n`);

  // ── auth: 10/minute ────────────────────────────────────────────────────────
  console.log("[auth bucket — documented 10/minute]");
  const authIp = `198.51.100.${(parseInt(stamp, 36) % 250) + 1}`;
  let refusedAt = -1;
  const authStatuses = [];
  for (let i = 1; i <= 14; i++) {
    const res = await hit("/auth/login", {
      method: "POST",
      f: form({ user_identifier: "nobody@example.invalid", password: "wrong" }),
      ip: authIp,
    });
    authStatuses.push(res.status);
    if (res.status === 429 && refusedAt === -1) refusedAt = i;
  }
  check("auth requests are eventually refused with 429", refusedAt > 0, `first 429 at request ${refusedAt}`);
  check("the first 10 auth requests were not refused", refusedAt === 11,
    `first refusal at ${refusedAt}, statuses ${authStatuses.join(",")}`);

  const refused = await hit("/auth/login", {
    method: "POST", f: form({ user_identifier: "nobody@example.invalid", password: "wrong" }), ip: authIp,
  });
  check("a refused request carries X-RateLimit-* headers",
    refused.h.get("x-ratelimit-limit") === "10" && refused.h.get("x-ratelimit-remaining") === "0",
    `limit=${refused.h.get("x-ratelimit-limit")} remaining=${refused.h.get("x-ratelimit-remaining")}`);
  check("a refused request carries Retry-After", Number(refused.h.get("retry-after")) > 0,
    `retry-after=${refused.h.get("retry-after")}`);
  check("a refused request has the documented 429 body shape",
    refused.json?.code === 429 && typeof refused.json?.message === "string",
    JSON.stringify(refused.json)?.slice(0, 80));

  // ── a different address is unaffected ─────────────────────────────────────
  console.log("\n[buckets are per client]");
  const other = await hit("/auth/login", {
    method: "POST", f: form({ user_identifier: "nobody@example.invalid", password: "wrong" }),
    ip: `198.51.100.${((parseInt(stamp, 36) % 250) + 1 + 7) % 250}`,
  });
  check("a different address has its own budget", other.status === 401, `got ${other.status}`);

  // ── general: 100/minute ───────────────────────────────────────────────────
  console.log("\n[general bucket — documented 100/minute]");
  const genIp = `192.0.2.${(parseInt(stamp, 36) % 250) + 1}`;
  let genRefused = -1;
  for (let i = 1; i <= 108; i++) {
    const res = await hit("/packages?query=fortran", { ip: genIp });
    if (res.status === 429 && genRefused === -1) genRefused = i;
  }
  check("general requests are refused after 100", genRefused === 101, `first 429 at ${genRefused}`);

  // ── upload: 5/hour ────────────────────────────────────────────────────────
  console.log("\n[upload bucket — documented 5/hour]");
  const user = `rl_${stamp}`;
  await hit("/auth/signup", {
    method: "POST",
    f: form({ username: user, email: `${user}@example.invalid`, password: "rl-password-1234" }),
    ip: `192.0.2.${(parseInt(stamp, 36) % 250) + 20}`,
  });
  await db.collection("users").updateOne({ username: user }, { $set: { isVerified: true } });
  const login = await hit("/auth/login", {
    method: "POST", f: form({ user_identifier: user, password: "rl-password-1234" }),
    ip: `192.0.2.${(parseInt(stamp, 36) % 250) + 21}`,
  });
  const bearer = login.json?.access_token ?? login.json?.accessToken;
  check("setup login succeeded", typeof bearer === "string");

  // Authenticate, so this probe exercises the per-account bucket rather than the
  // per-address one.
  const statuses = [];
  for (let i = 1; i <= 8; i++) {
    const f = form({ package_name: `rlpkg${i}`, package_version: "1.0.0", package_license: "MIT" });
    f.append("tarball", new Blob([new Uint8Array([1, 2, 3])], { type: "application/gzip" }), "a.tar.gz");
    const res = await hit("/packages", { method: "POST", f, bearer, ip: `192.0.2.${(parseInt(stamp, 36) % 250) + 21}` });
    statuses.push(res.status);
  }
  const uploadRefusals = statuses.filter((s) => s === 429).length;
  check("uploads are refused once the hourly budget is gone", uploadRefusals >= 2,
    `statuses ${statuses.join(",")}`);

  // The refusal must be the *upload* bucket, not the auth or general one.
  const lastRefusal = await (async () => {
    const f = form({ package_name: "rlpkg9", package_version: "1.0.0", package_license: "MIT" });
    f.append("tarball", new Blob([new Uint8Array([1, 2, 3])], { type: "application/gzip" }), "a.tar.gz");
    return hit("/packages", { method: "POST", f, bearer, ip: `192.0.2.${(parseInt(stamp, 36) % 250) + 21}` });
  })();
  check("the upload bucket is 5/hour, distinct from the others",
    lastRefusal.h.get("x-ratelimit-limit") === "5",
    `limit=${lastRefusal.h.get("x-ratelimit-limit")}`);

  // ── exempt paths ──────────────────────────────────────────────────────────
  console.log("\n[exempt paths]");
  for (const path of ["/health", "/", "/apidocs", "/apidocs/openapi.json"]) {
    const res = await hit(path);
    check(`${path} is exempt from limiting`, res.status < 429 && !res.h.get("x-ratelimit-limit"),
      `status=${res.status} limit=${res.h.get("x-ratelimit-limit")}`);
  }

  // ── fail-open: headers without 429 would be a lie ─────────────────────────
  console.log("\n[the headers tell the truth]");
  const okRes = await hit("/packages?query=fortran", { ip: `192.0.2.${(parseInt(stamp, 36) % 250) + 60}` });
  check("a successful response advertises its budget",
    okRes.h.get("x-ratelimit-limit") === "100" && Number(okRes.h.get("x-ratelimit-remaining")) <= 100,
    `remaining=${okRes.h.get("x-ratelimit-remaining")}`);

  const corsRes = await fetch(`${API}/packages?query=fortran`, {
    headers: { Origin: "http://localhost:5173", "cf-connecting-ip": `192.0.2.${(parseInt(stamp, 36) % 250) + 61}` },
  });
  check("CORS headers survive alongside the rate headers",
    corsRes.headers.get("access-control-allow-origin") === "http://localhost:5173" &&
      corsRes.headers.get("x-ratelimit-limit") === "100");

  // Cleanup.
  await db.collection("users").deleteMany({ username: user });
  await db.collection("packages").deleteMany({ name: /^rlpkg/ });
  await c.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ${f.n}: ${f.d}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
