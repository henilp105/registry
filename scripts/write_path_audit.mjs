#!/usr/bin/env node
/**
 * End-to-end exercise of the API's *write* half, against the running Worker and
 * the live Atlas cluster.
 *
 *   node scripts/write_path_audit.mjs [API_BASE]
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The reads were only found broken because real documents were pushed through
 * them: workerd cannot serialise a BSON ObjectId across the Durable Object
 * boundary, so every read route 500'd. Nothing had ever exercised a **write**.
 *
 * Writes are the larger and riskier half: authentication, publish, R2 upload,
 * ratings, deprecation, and three cascade deletes. A silent failure here is worse
 * than a broken read, because it corrupts state rather than merely failing to
 * show it.
 *
 * Every step asserts on the response *and* on the resulting database state, since
 * the recurring failure mode is "HTTP 200 with a message claiming success" --
 * which is exactly what `v0.0.1` did on `delete_namespace` for every request.
 *
 * ── Honest limitation ───────────────────────────────────────────────────────
 * Email verification cannot be completed through the API here, because the raw
 * token only ever exists inside the verification email and `BREVO_API_KEY` is
 * unset. It is stored hashed, by design (defect D2). So this harness:
 *
 *   - asserts the verification route *rejects* a bare account uuid and a
 *     fabricated token, which is the security-relevant behaviour;
 *   - sets `isVerified` directly in Mongo to stand in for clicking the emailed
 *     link, and says so at every step that depends on it.
 */

import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";

const API = process.argv[2] ?? "http://127.0.0.1:8787";
const URI =
  "mongodb+srv://henilp105_db_user:FsPIM1HkOairYjZj@cluster0.kdreahb.mongodb.net/?appName=Cluster0";
const DB = "fpmregistry_local";

let passed = 0;
let failed = 0;
const failures = [];

const ok = (name, detail = "") => {
  passed++;
  console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
};
const bad = (name, detail) => {
  failed++;
  failures.push({ name, detail });
  console.log(`  FAIL  ${name} — ${detail}`);
};
const check = (name, cond, detail = "") => (cond ? ok(name, detail) : bad(name, detail || "assertion failed"));

/**
 * A stable source address for this run.
 *
 * Rate limiting keys on `cf-connecting-ip` for anonymous callers and on the
 * authenticated identity otherwise, so two harness runs would otherwise share one
 * budget and the second would be refused by the first's traffic. Cloudflare sets
 * this header in production; locally there is no such header, so the middleware
 * falls back to reading it, which is what makes this work.
 *
 * A distinct address per run is also what a real CI fleet looks like, so this
 * matches production rather than working around the limiter.
 */
const RUN_IP = `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function req(path, { method = "GET", form, bearer, headers = {} } = {}) {
  const init = { method, headers: { "cf-connecting-ip": RUN_IP, ...headers } };
  if (bearer) init.headers.Authorization = `Bearer ${bearer}`;
  if (form) init.body = form;
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body (e.g. a tarball) */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const form = (obj) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) f.append(k, String(v));
  }
  return f;
};

/** A minimal but structurally valid .tar.gz, so the upload path does real work. */
async function makeTarball(name = "harness") {
  // Deterministic gzip of a short JSON manifest. Not a real fpm artifact, but the
  // upload path validates the name, size and digest, not the Fortran inside.
  const payload = new TextEncoder().encode(
    JSON.stringify({ name, version: "1.0.0", fpm: { name, version: "1.0.0" } }),
  );
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(payload);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB);

  const stamp = Date.now().toString(36);
  const username = `harness_${stamp}`;
  const password = "harness-password-1234";
  const email = `${username}@example.invalid`;
  const NS = `harnessns${stamp.toLowerCase()}`;
  const PKG = "harness-pkg";

  console.log(`\nwrite-path audit against ${API}, db ${DB}`);
  console.log(`test account: ${username}\n`);

  // ── 1. signup ──────────────────────────────────────────────────────────────
  console.log("[signup and authentication]");
  const signup = await req("/auth/signup", {
    method: "POST",
    form: form({ username, email, password }),
  });
  check("signup returns 200", signup.status === 200, `got ${signup.status} ${signup.text.slice(0, 90)}`);
  const signupDoesNotLeakUuid = !/"uuid"/.test(signup.text);
  check(
    "signup does not return the account uuid",
    signupDoesNotLeakUuid,
    signupDoesNotLeakUuid ? "" : signup.text.slice(0, 160),
  );

  // The user really exists.
  const created = await db.collection("users").findOne({ username });
  check("signup persisted the user", !!created);

  // ── 2. unverified login is refused ─────────────────────────────────────────
  const early = await req("/auth/login", {
    method: "POST",
    form: form({ user_identifier: username, password }),
  });
  check(
    "login before verification is refused",
    early.status === 401,
    `got ${early.status}`,
  );

  // ── 3. the D2 fix: a bare uuid must not verify anything ───────────────────
  const uuidAttack = await req("/auth/verify-email", {
    method: "POST",
    form: form({ uuid: created?.uuid ?? "" }),
  });
  check(
    "verify-email rejects a bare account uuid (D2)",
    uuidAttack.status === 401,
    `got ${uuidAttack.status} ${uuidAttack.json?.message ?? ""}`,
  );

  const fabricated = await req("/auth/verify-email", {
    method: "POST",
    form: form({ uuid: randomUUID() }),
  });
  check(
    "verify-email rejects a fabricated token",
    fabricated.status === 401,
    `got ${fabricated.status}`,
  );

  // ── 4. stand in for clicking the emailed link ──────────────────────────────
  // Documented limitation: the raw token exists only in the email, and
  // BREVO_API_KEY is unset. This is the one place the harness reaches past the
  // API, and it is why steps after here are marked as assuming verification.
  await db.collection("users").updateOne({ username }, { $set: { isVerified: true } });

  // ── 5. login ───────────────────────────────────────────────────────────────
  const login = await req("/auth/login", {
    method: "POST",
    form: form({ user_identifier: username, password }),
  });
  check("login returns 200", login.status === 200, `got ${login.status} ${login.text.slice(0, 90)}`);
  const access = login.json?.access_token ?? login.json?.accessToken;
  const refresh = login.json?.refresh_token ?? login.json?.refreshToken;
  check("login returns an access token", typeof access === "string" && access.length > 20);
  check("login returns a refresh token", typeof refresh === "string" && refresh.length > 20);

  // Wrong password must be indistinguishable from an unknown account.
  const wrongPw = await req("/auth/login", {
    method: "POST",
    form: form({ user_identifier: username, password: "wrong-password-entirely" }),
  });
  const unknownUser = await req("/auth/login", {
    method: "POST",
    form: form({ user_identifier: "no-such-account-here", password }),
  });
  check(
    "wrong password and unknown account are indistinguishable",
    wrongPw.status === unknownUser.status &&
      wrongPw.json?.message === unknownUser.json?.message,
    `${wrongPw.status}/${wrongPw.json?.message} vs ${unknownUser.status}/${unknownUser.json?.message}`,
  );

  // ── 6. refresh ─────────────────────────────────────────────────────────────
  const refreshed = await req("/auth/refresh", { method: "POST", bearer: refresh });
  check(
    "refresh returns a new token pair",
    refreshed.status === 200 && typeof refreshed.json?.access_token === "string",
    `got ${refreshed.status} ${refreshed.text.slice(0, 90)}`,
  );

  // ── 7. admin probe ─────────────────────────────────────────────────────────
  // `POST /users/admin` answers 401 for a non-admin rather than
  // `isAdmin: "false"` -- it is an admin-only probe, not a role query. Asserting
  // a 200 here for an ordinary user was a harness bug, not a product one.
  const adminProbe = await req("/users/admin", { method: "POST", bearer: access });
  check(
    "users/admin refuses a non-admin with 401",
    adminProbe.status === 401,
    `got ${adminProbe.status} ${adminProbe.json?.message ?? ""}`,
  );

  // ── 8. namespace creation ──────────────────────────────────────────────────
  console.log("\n[namespace lifecycle]");
  const nsCreate = await req("/namespaces", {
    method: "POST",
    bearer: access,
    form: form({ namespace: NS, namespace_description: "created by the write-path audit" }),
  });
  check("create namespace returns 200", nsCreate.status === 200, `got ${nsCreate.status} ${nsCreate.text.slice(0, 90)}`);
  const nsDoc = await db.collection("namespaces").findOne({ namespace: NS });
  check("namespace persisted", !!nsDoc);
  check(
    "creator is seeded into admins and maintainers",
    !!nsDoc?.admins?.length && !!nsDoc?.maintainers?.length,
    `admins=${nsDoc?.admins?.length} maintainers=${nsDoc?.maintainers?.length}`,
  );

  // Duplicate must be rejected.
  const nsDup = await req("/namespaces", {
    method: "POST",
    bearer: access,
    form: form({ namespace: NS, namespace_description: "duplicate" }),
  });
  check("duplicate namespace is rejected", nsDup.status === 400, `got ${nsDup.status}`);

  // ── 9. upload token ────────────────────────────────────────────────────────
  console.log("\n[publish token and upload]");
  const token = await req(`/namespaces/${NS}/uploadToken`, { method: "POST", bearer: access });
  check("mint upload token returns 200", token.status === 200, `got ${token.status}`);
  const uploadToken = token.json?.upload_token ?? token.json?.uploadToken;
  check("token is returned under both spellings",
    typeof token.json?.upload_token === "string" && token.json?.uploadToken === token.json?.upload_token);

  // Tokens live in their own `upload_tokens` collection, not on the namespace
  // document -- `v0.0.1` pushed them onto `namespaces.upload_tokens[]` forever
  // with no sweep, growing the document to MongoDB's 16 MB cap (defect D4).
  const stored = await db.collection("upload_tokens").find({}).toArray();
  const mine = stored.filter((t) => t.namespace === nsDoc?._id?.toHexString() || t.scope?.namespace === NS);
  check("an upload token was persisted", stored.length > 0, `${stored.length} rows`);
  check(
    "the token is stored hashed, never in the clear",
    stored.length > 0 && JSON.stringify(stored).indexOf(String(uploadToken)) === -1,
    "raw token absent from storage",
  );
  check(
    "no token lives on the namespace document (D4)",
    (await db.collection("namespaces").findOne({ namespace: NS }, { projection: { upload_tokens: 1 } }))?.upload_tokens === undefined,
  );

  // ── 10. dry run persists nothing ───────────────────────────────────────────
  const tarball = await makeTarball(PKG);
  const dry = await req("/packages", {
    method: "POST",
    form: (() => {
      const f = form({
        upload_token: uploadToken, package_name: PKG, package_version: "1.0.0",
        package_license: "MIT", dry_run: "true",
      });
      f.append("tarball", new Blob([tarball], { type: "application/gzip" }), `${PKG}-1.0.0.tar.gz`);
      return f;
    })(),
  });
  check("dry_run returns 200", dry.status === 200, `got ${dry.status} ${dry.text.slice(0, 90)}`);
  check("dry_run wrote no package document",
    (await db.collection("packages").countDocuments({ name: PKG, namespace_name: NS })) === 0);

  // ── 11. real publish ───────────────────────────────────────────────────────
  const publish = await req("/packages", {
    method: "POST",
    form: (() => {
      const f = form({
        upload_token: uploadToken, package_name: PKG,
        package_version: "1.0.0", package_license: "MIT",
      });
      f.append("tarball", new Blob([tarball], { type: "application/gzip" }), `${PKG}-1.0.0.tar.gz`);
      return f;
    })(),
  });
  check("publish returns 200", publish.status === 200, `got ${publish.status} ${publish.text.slice(0, 140)}`);
  const pkg = await db.collection("packages").findOne({ name: PKG, namespace_name: NS });
  check("package document written", !!pkg);

  // The digest is the D24 fix: v0.0.1 stored no checksum anywhere.
  const version = (pkg?.versions ?? [])[0];
  check("version records a sha256 digest",
    typeof version?.sha256 === "string" && /^[0-9a-f]{64}$/.test(version.sha256),
    String(version?.sha256).slice(0, 16));

  // ── 12. download from R2 ──────────────────────────────────────────────────
  const download = await fetch(`${API}/tarballs/${NS}/${PKG}/1.0.0`);
  const bytes = new Uint8Array(await download.arrayBuffer());
  check("artifact downloads from R2", download.status === 200, `got ${download.status}`);
  check("downloaded bytes match what was uploaded",
    bytes.length === tarball.length && Buffer.from(bytes).equals(Buffer.from(tarball)),
    `${bytes.length} vs ${tarball.length}`);
  check("response carries the checksum header",
    typeof download.headers.get("x-checksum-sha256") === "string");

  // ── 13. rating ─────────────────────────────────────────────────────────────
  console.log("\n[ratings, deprecation, cascades]");
  const rate = await req(`/ratings/${NS}/${PKG}`, { method: "POST", bearer: access, form: form({ rating: 5 }) });
  check("rating accepted", rate.status === 200, `got ${rate.status} ${rate.text.slice(0, 90)}`);
  // Ratings are stored *inside* the package document at `ratings.users.<userId>`,
  // not in a collection of their own. That is deliberate: the counts are derived
  // in the read pipeline, so two concurrent votes cannot lose each other the way
  // a read-modify-write counter would. Asserting against a `ratings` collection
  // was a harness bug.
  const rated = await db.collection("packages").findOne({ name: PKG, namespace_name: NS });
  const voterId = String(created?._id ?? "");
  check(
    "rating persisted on the package document",
    typeof rated?.ratings?.users?.[voterId] === "number",
    JSON.stringify(rated?.ratings?.users ?? {}),
  );

  // Out-of-range must be refused.
  const badRate = await req(`/ratings/${NS}/${PKG}`, { method: "POST", bearer: access, form: form({ rating: 9 }) });
  check("rating of 9 is refused", badRate.status === 400, `got ${badRate.status}`);

  // ── 14. deprecate (D26: this route did not exist at all) ───────────────────
  const dep = await req("/packages", {
    method: "PUT",
    bearer: access,
    form: form({ namespace: NS, name: PKG, isDeprecated: "true" }),
  });
  check("PUT /packages deprecates", dep.status === 200, `got ${dep.status} ${dep.text.slice(0, 90)}`);
  const deprecated = await db.collection("packages").findOne({ name: PKG, namespace_name: NS });
  const latest = (deprecated?.versions ?? [])[0];

  // ── 14b. the admin boundary, asserted before exercising the cascades ────────
  // Every delete below is site-admin-only. This harness user is an ordinary
  // account, so the boundary is checked first: a non-admin must be refused, and
  // only then is an admin promoted to run the real cascade.
  console.log("\n[admin boundary]");
  for (const [label, path] of [
    ["delete version", `/packages/${NS}/${PKG}/1.0.0/delete`],
    ["delete package", `/packages/${NS}/${PKG}/delete`],
    ["delete namespace", `/namespace/${NS}/delete`],
  ]) {
    const res = await req(path, { method: "POST", bearer: access, form: form({}) });
    check(`${label} is refused for a non-admin`, res.status === 401 || res.status === 403,
      `got ${res.status}`);
  }
  check(
    "the refused deletes changed nothing",
    (await db.collection("packages").countDocuments({ name: PKG, namespace_name: NS })) === 1,
  );

  // Promote, through the database rather than the API: `v0.0.1` granted admin by
  // password match on signup (defect D1), which is not a mechanism to reproduce.
  await db.collection("users").updateOne({ username }, { $set: { roles: ["admin"] } });
  const adminProbe2 = await req("/users/admin", { method: "POST", bearer: access });
  check(
    "users/admin answers 'true' as a string once admin (D32)",
    adminProbe2.status === 200 && adminProbe2.json?.isAdmin === "true",
    `got ${adminProbe2.status} isAdmin=${JSON.stringify(adminProbe2.json?.isAdmin)}`,
  );
  check("isAdmin is a string, not a boolean",
    typeof adminProbe2.json?.isAdmin === "string", `typeof ${typeof adminProbe2.json?.isAdmin}`);

  // ── 15. version delete ─────────────────────────────────────────────────────
  const vdel = await req(`/packages/${NS}/${PKG}/1.0.0/delete`, { method: "POST", bearer: access });
  check("delete version returns 200", vdel.status === 200, `got ${vdel.status} ${vdel.text.slice(0, 90)}`);
  const afterVdel = await db.collection("packages").findOne({ name: PKG, namespace_name: NS });
  check("the named version is actually gone",
    (afterVdel?.versions ?? []).length === 0,
    `${(afterVdel?.versions ?? []).length} versions remain`);

  // A version that never existed must not claim success (v0.0.1 returned 200
  // for any string here, reporting a deletion that had not happened).
  const ghost = await req(`/packages/${NS}/${PKG}/9.9.9/delete`, { method: "POST", bearer: access });
  check("deleting a nonexistent version is refused, not faked",
    ghost.status === 404, `got ${ghost.status}`);

  // ── 15b. republish, because deleting the last version removes the package ──
  // `deleteVersion` intentionally deletes a package left with no versions ("no
  // longer installable"), so step 15 leaves no package behind at all. Publishing
  // again gives the cascade below a real subject rather than asserting against a
  // self-inflicted absence.
  //
  // Only one version is expected afterwards, not two: the 1.0.0 document was
  // deleted along with its last version, so this is a fresh package holding
  // 2.0.0. Asserting two was my error.
  const f2 = form({
    upload_token: uploadToken, package_name: PKG,
    package_version: "2.0.0", package_license: "MIT",
  });
  f2.append("tarball", new Blob([tarball], { type: "application/gzip" }), `${PKG}-2.0.0.tar.gz`);
  const republish = await req("/packages", { method: "POST", form: f2 });
  check("republish a second version", republish.status === 200, `got ${republish.status}`);
  const twoVersions = await db.collection("packages").findOne({ name: PKG, namespace_name: NS });
  check("the republished package holds its one version",
    (twoVersions?.versions ?? []).length === 1, `${(twoVersions?.versions ?? []).length}`);

  // Deprecating must reach the version flags the client actually reads.
  const depAgain = await req("/packages", {
    method: "PUT", bearer: access,
    form: form({ namespace: NS, name: PKG, isDeprecated: "true" }),
  });
  check("PUT /packages deprecates", depAgain.status === 200, `got ${depAgain.status}`);
  const depDoc = await db.collection("packages").findOne({ name: PKG, namespace_name: NS });
  const depVersion = (depDoc?.versions ?? [])[0];
  check(
    "deprecation reaches the version-level flag the client reads (D56)",
    depVersion?.is_deprecated === true && depVersion?.isDeprecated === "true",
    `is_deprecated=${JSON.stringify(depVersion?.is_deprecated)} isDeprecated=${JSON.stringify(depVersion?.isDeprecated)}`,
  );
  const depRead = await req(`/packages/${NS}/${PKG}`);
  check(
    "the deprecated package reports isDeprecated to the API",
    depRead.json?.data?.latest_version_data?.isDeprecated === "true",
    `isDeprecated=${JSON.stringify(depRead.json?.data?.latest_version_data?.isDeprecated)}`,
  );
  check("a deprecated package drops out of search",
    !(await req("/packages?query=fortran")).json?.packages?.some((p) => p.name === PKG));

  // And un-deprecating must put it back -- the whole point of accepting "false".
  const undeprecate = await req("/packages", {
    method: "PUT", bearer: access,
    form: form({ namespace: NS, name: PKG, isDeprecated: "false" }),
  });
  check("PUT /packages un-deprecates", undeprecate.status === 200, `got ${undeprecate.status}`);
  const undeprDoc = await db.collection("packages").findOne({ name: PKG, namespace_name: NS });
  check("un-deprecation reaches the version flag too",
    (undeprDoc?.versions ?? [])[0]?.is_deprecated === false &&
    (undeprDoc?.versions ?? [])[0]?.isDeprecated === "false");

  // ── 16. package cascade delete ─────────────────────────────────────────────
  const pdel = await req(`/packages/${NS}/${PKG}/delete`, { method: "POST", bearer: access });
  check("delete package returns 200", pdel.status === 200, `got ${pdel.status} ${pdel.text.slice(0, 90)}`);
  check("package document is gone",
    (await db.collection("packages").countDocuments({ name: PKG, namespace_name: NS })) === 0);
  const nsAfter = await db.collection("namespaces").findOne({ namespace: NS });
  check("the namespace's package reference was cascaded",
    !(nsAfter?.packages ?? []).includes(PKG),
    JSON.stringify(nsAfter?.packages ?? []));

  // ── 17. namespace cascade delete (D: never worked, always code:500) ────────
  console.log("\n[namespace and user cascade]");
  const ndel = await req(`/namespace/${NS}/delete`, { method: "POST", bearer: access });
  check("delete namespace returns HTTP 200", ndel.status === 200, `got ${ndel.status}`);
  check("delete namespace reports code 200 in the body",
    ndel.json?.code === 200,
    `body code=${ndel.json?.code} message=${ndel.json?.message}`);
  check("namespace document is actually gone",
    (await db.collection("namespaces").countDocuments({ namespace: NS })) === 0);

  // ── 18. unauthenticated writes must be refused ─────────────────────────────
  console.log("\n[authorisation on writes]");
  for (const [label, path, body] of [
    ["create namespace", "/namespaces", { namespace: "nope", namespace_description: "x" }],
    ["mint upload token", `/namespaces/${NS}/uploadToken`, {}],
    ["delete package", `/packages/${NS}/${PKG}/delete`, {}],
    ["rate a package", `/ratings/${NS}/${PKG}`, { rating: 5 }],
    ["delete user", "/users/delete", { username }],
  ]) {
    const res = await req(path, { method: "POST", form: form(body) });
    check(`${label} without a token is refused`, res.status === 401 || res.status === 403,
      `got ${res.status}`);
  }

  // ── 19. a forged bearer token ──────────────────────────────────────────────
  const forged = await req("/users/admin", { method: "POST", bearer: "not.a.real.token" });
  check("forged bearer token is refused", forged.status === 401, `got ${forged.status}`);

  // A token signed with the right shape but the wrong secret must not verify.
  const [wrongSecret] = await Promise.all([
    (async () => {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const header = b64({ alg: "HS256", typ: "JWT" });
      const payload = b64({ uuid: created?.uuid, type: "access", exp: Math.floor(Date.now() / 1000) + 999 });
      const sig = await crypto.subtle.sign(
        "HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode("wrong-secret"),
          { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
        new TextEncoder().encode(`${header}.${payload}`),
      );
      return `${header}.${payload}.${Buffer.from(sig).toString("base64url")}`;
    })(),
  ]);
  const forgedSigned = await req("/users/admin", { method: "POST", bearer: wrongSecret });
  check("JWT signed with the wrong secret is refused",
    forgedSigned.status === 401, `got ${forgedSigned.status}`);

  // ── 20. user cascade delete ────────────────────────────────────────────────
  const udel = await req("/users/delete", { method: "POST", bearer: access, form: form({ username }) });
  check("delete user returns 200", udel.status === 200, `got ${udel.status} ${udel.text.slice(0, 90)}`);
  check("user document is gone",
    (await db.collection("users").countDocuments({ username })) === 0);

  // ── 21. the surviving legacy fixture still reads ───────────────────────────
  console.log("\n[regression: the read paths still work]");
  const search = await req("/packages?query=fortran");
  check("search still returns the seeded packages",
    search.status === 200 && (search.json?.packages ?? []).length > 0,
    `${(search.json?.packages ?? []).length} results`);
  const nsRead = await req("/namespace/stdlib");
  check("namespace listing still returns packages",
    nsRead.status === 200 && (nsRead.json?.packages ?? []).length > 0,
    `${(nsRead.json?.packages ?? []).length} packages`);
  const cli = await req("/packages_cli?query=fortran&page=1");
  check("packages_cli answers (D48)", cli.status === 200, `got ${cli.status}`);
  const cliEmpty = await req("/packages_cli?query=zzzz-definitely-no-match");
  check("packages_cli 404s on empty, per its legacy contract",
    cliEmpty.status === 404, `got ${cliEmpty.status}`);

  // ── cleanup ────────────────────────────────────────────────────────────────
  await db.collection("users").deleteMany({ username });
  await db.collection("namespaces").deleteMany({ namespace: NS });
  await db.collection("packages").deleteMany({ name: PKG });
  await client.close();

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ${f.name}: ${f.detail}`);
  }
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
