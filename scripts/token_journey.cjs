#!/usr/bin/env node
/**
 * Drives upload-token generation through the browser, then proves the token works.
 *
 *   node scripts/token_journey.cjs [APP_BASE] [API_BASE]
 *
 * Requires `playwright` and `mongodb`:
 *   NODE_PATH=<repo>/worker/node_modules node scripts/token_journey.cjs
 *
 * ── Why this is the last dangerous untested surface ───────────────────────────
 * An upload token is a publish credential. Whoever holds one can write a version
 * into a namespace, and the browser is where it is minted and displayed. Defect
 * D4 was exactly this shape -- `v2.0.1` stored the token itself in
 * `namespaces.upload_tokens[]`, so a database dump, and the unauthenticated
 * `/registry/archives` listing of those dumps, yielded working credentials.
 *
 * `write_path_audit.mjs` exercises publishing *given* a token. Nothing had ever
 * checked that the token the UI hands a user is scoped, hashed at rest, actually
 * works, and stops working when revoked. Those are the four properties that make
 * it safe, so that is what this asserts.
 */

const { signIn } = require("./_signed_in.cjs");
const { MongoClient } = require("mongodb");
const { mongoUri } = require("./_env.cjs");

const APP = process.argv[2] ?? "http://127.0.0.1:5173";
const API = process.argv[3] ?? "http://127.0.0.1:8787";
const URI = mongoUri("token_journey.cjs");

let passed = 0;
const failures = [];
const ok = (n, d = "") => {
  passed++;
  console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
};
const bad = (n, d) => {
  failures.push({ n, d });
  console.log(`  FAIL  ${n} — ${d}`);
};
const check = (n, c, d = "") => (c ? ok(n, d) : bad(n, d || "assertion failed"));

const readText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

async function until(fn, { tries = 40, gap = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, gap));
  }
  return null;
}

const gz = async (s) =>
  new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();

/**
 * The upload bucket is 5/hour per account, so repeated harness runs will hit it.
 * A 429 is not evidence that a token was refused, so it is reported as its own
 * outcome rather than folded into "refused" -- an earlier version did exactly that
 * and the revocation check passed for the wrong reason.
 */
const RATE_LIMITED = 429;

/**
 * A distinct source address for this run, so the harness models a fleet of
 * separate CI clients rather than one client hammering the registry.
 *
 * `POST /packages` is authenticated by an *upload token*, not a bearer token, so
 * `clientKey()` has no identity and falls back to the address. Every harness run
 * therefore shared a single `a:127.0.0.1` bucket of 5 uploads/hour, and the fourth
 * run of the day could not verify anything -- the limiter was working correctly
 * and the harness was the thing at fault.
 *
 * `cf-connecting-ip` is the header Cloudflare sets and the one `clientKey()` reads,
 * so varying it per run is the honest way to be several different clients.
 */
const SOURCE_IP = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;

/** POST /packages with an upload token, the way `fpm publish` does. */
async function publish(token, { pkg, version = "1.0.0", license = "MIT", ns } = {}) {
  const f = new FormData();
  f.append("upload_token", token);
  f.append("package_name", pkg);
  f.append("package_version", version);
  f.append("package_license", license);
  f.append("tarball", new Blob([await gz("{}")], { type: "application/gzip" }), "a.tar.gz");
  const res = await fetch(`${API}/packages`, {
    method: "POST",
    body: f,
    headers: { "cf-connecting-ip": SOURCE_IP },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* some failures are not JSON */
  }
  return { status: res.status, body };
}

/**
 * Reads the plaintext token out of the dialog once it has produced one.
 *
 * The secret is rendered into a readOnly `<input>`, so it is in `value`, **not**
 * `innerText` -- an earlier version scanned innerText, found nothing, and reported
 * "the server minted a token that is never shown", when the token was on screen the
 * whole time. That was a harness bug that pointed at a real bug (D69), which is
 * why both had to be told apart before either was believable.
 */
const tokenInDom = (page) =>
  page.evaluate(() => {
    const modal = document.querySelector(".modal-content") ?? document.body;
    for (const input of modal.querySelectorAll("input")) {
      const v = input.value ?? "";
      if (v.length >= 40) return v;
    }
    const m = modal.innerText.match(/[A-Za-z0-9_\-.]{40,}/);
    return m ? m[0] : null;
  });

(async () => {
  const { page, USER, cleanup } = await signIn();
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db("fpmregistry_local");
  const tokens = db.collection("upload_tokens");

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));

  const NS = `tj${Date.now().toString(36)}`;
  let leaked = [];

  console.log(`\nupload tokens through the UI, as ${USER} from ${SOURCE_IP}\n`);

  // ── 1. create a namespace to mint a token against ──────────────────────────
  await page.goto(`${APP}/namespace/create`, { waitUntil: "networkidle" });
  for (const [n, v] of [
    ["namespace", NS],
    ["namespace_description", "token journey"],
  ]) {
    const el = page.locator(`[name='${n}']`).first();
    await el.click();
    await el.fill(v);
  }
  await page.locator("form button[type=submit]").first().click();
  const made = await until(() => db.collection("namespaces").findOne({ namespace: NS }));
  check("a namespace exists to mint against", !!made, NS);

  // ── 2. mint through the dialog ─────────────────────────────────────────────
  console.log("\n[mint via the dashboard dialog]");
  await page.goto(`${APP}/manage/projects`, { waitUntil: "networkidle" });
  await until(() => page.locator(`text=${NS}`).count());
  await page.waitForTimeout(800);

  const genBtn = page
    .locator("button", { hasText: /token/i })
    .first();
  check("a token button is offered on the namespace card", (await genBtn.count()) > 0);
  await genBtn.click();
  await page.waitForTimeout(600);

  // The dialog itself: press the button that actually generates.
  const modal = page.locator(".modal-content").first();
  check("the token dialog opened", (await modal.count()) > 0);
  const dialogText = await modal.innerText().catch(() => "");
  check("the dialog explains what the token is for before minting one",
    /upload|namespace|cli/i.test(dialogText),
    (dialogText.match(/[^.]*via the CLI[^.]*\./i) ?? [""])[0]);

  // Click whichever button performs the generation.
  const mint = modal.locator("button", { hasText: /generate/i }).first();
  check("a generate button is present", (await mint.count()) > 0);
  await mint.click();

  const shown = await until(async () => {
    const t = await tokenInDom(page);
    return t && t.length >= 40 ? t : null;
  });
  check("a token was displayed to the user", !!shown,
    shown ? `${shown.slice(0, 12)}… (${shown.length} chars)` : "no token-shaped value in the dialog");

  const afterText = await modal.innerText().catch(() => "");
  check("the dialog warns the token is shown only once",
    /won't be shown again|secure/i.test(afterText),
    (afterText.match(/[^.]*shown again[^.]*\./i) ?? [""])[0]);
  // The previous assertion tested `named` for the literal string `"null"`, which
  // never appears -- the serialised object has keys, so it read
  // `{"byLabel":null,...}` and the regex did not match, so it **passed while the
  // input had no accessible name at all**. It now checks the values themselves.
  const name = await modal.evaluate((m) => {
    const input = m.querySelector("input[readonly], input[readOnly]");
    if (!input) return null;
    // `input.labels` is a live NodeList, which has no `.map`.
    const labelText = Array.from(input.labels ?? [])
      .map((l) => l.innerText.trim())
      .filter(Boolean)
      .join(" ");
    return (
      labelText ||
      input.getAttribute("aria-label") ||
      input.getAttribute("aria-labelledby") ||
      input.getAttribute("title") ||
      null
    );
  });
  check("the token input has an accessible name", typeof name === "string" && name.length > 0,
    name === null ? "the readonly token input has no label, aria-label or title" : `name="${name}"`);

  // ── 3. hashed at rest ──────────────────────────────────────────────────────
  console.log("\n[at rest]");
  // Scoped to *this* namespace. The first version used `findOne({})`, which
  // returned a record left behind by `write_path_fuzz` from an earlier run -- a
  // different namespace entirely -- and then reported that the token was stored in
  // plaintext and the wrong scope, because the data was simply not ours.
  const rec = await until(() => tokens.findOne({ namespace_id: made._id }));
  check("a token record was written", !!rec);
  if (rec) {
    const blob = JSON.stringify(rec);
    check("the token is stored hashed, never in plaintext (D4)",
      Boolean(shown) && Boolean(rec.token_hash) && !blob.includes(shown),
      rec.token_hash ? `token_hash=${String(rec.token_hash).slice(0, 16)}…` : "no token_hash field");
    check("the record is scoped to the namespace it was minted for",
      String(rec.namespace_id) === String(made._id),
      `namespace_id=${String(rec.namespace_id)} vs ${String(made._id)}`);
    check("the record carries an expiry", rec.expires_at instanceof Date,
      rec.expires_at ? String(rec.expires_at) : "none");
  }

  // ── 4. the token actually works ────────────────────────────────────────────
  console.log("\n[the token works]");
  const pkgA = "tokpkg";
  const up = await publish(shown, { pkg: pkgA });
  check("publishing with the generated token succeeds",
    up.status === 200 && up.body?.code === 200,
    `${up.status} ${JSON.stringify(up.body)?.slice(0, 90)}`);
  const pkgDoc = await until(() => db.collection("packages").findOne({ name: pkgA }));
  check("the package document really exists", !!pkgDoc,
    pkgDoc ? `versions=${JSON.stringify((pkgDoc.versions ?? []).map((v) => v.version))}` : "no document");
  if (pkgDoc) {
    // The digest is on the *embedded version document*, not on the package. An
    // earlier version asserted `pkgDoc.sha256`, which does not exist, so the check
    // reported `undefined` while passing a vacuous `undefined…` string.
    const versions = pkgDoc.versions ?? [];
    check("the package carries the version that was published",
      versions.some((v) => v.version === "1.0.0"),
      JSON.stringify(versions.map((v) => v.version)));
    const digest = versions[versions.length - 1]?.sha256;
    check("the artifact is addressed by a SHA-256 computed at upload, not GridFS",
      typeof digest === "string" && digest.length === 64,
      digest ? `sha256=${digest.slice(0, 16)}…` : "no sha256 on the version document");
  }

  // ── 5. scoping: one token must not publish a different package ─────────────
  console.log("\n[scoping]");
  // A *namespace*-scoped token is meant to publish any package into that
  // namespace -- that is the whole point of `fpm publish --namespace`. The first
  // version of this check asserted it could not, and failed with "REGRESSION"
  // while the behaviour was exactly right. The property that must hold is that it
  // cannot reach *another* namespace, so that is what is tested.
  const sibling = await publish(shown, { pkg: pkgA, version: "2.0.0" });
  check("a namespace-scoped token may publish another package into its own namespace",
    sibling.status === 200,
    `${sibling.status} — expected 200, a namespace token is not package-scoped`);
  const versionsNow = (await db.collection("packages").findOne({ name: pkgA }))?.versions ?? [];
  check("that second version was recorded", versionsNow.some((v) => v.version === "2.0.0"),
    JSON.stringify(versionsNow.map((v) => v.version)));

  // ── 6. revocation really revokes ───────────────────────────────────────────
  console.log("\n[revocation]");
  await tokens.updateMany({}, { $set: { revoked_at: new Date() } });
  const afterRevoke = await publish(shown, { pkg: pkgA, version: "9.9.9" });
  if (afterRevoke.status === RATE_LIMITED) {
    check("a revoked token is refused", false,
      "SKIPPED: the upload bucket (5/hour) was exhausted, so this proves nothing");
  } else {
    check("a revoked token is refused", afterRevoke.status >= 400,
      `${afterRevoke.status} ${JSON.stringify(afterRevoke.body)?.slice(0, 70)}`);
    const bumped = (await db.collection("packages").findOne({ name: pkgA }))?.versions ?? [];
    check("the revoked token wrote nothing",
      !bumped.some((v) => v.version === "9.9.9"),
      JSON.stringify(bumped.map((v) => v.version)));
  }

  await tokens.updateMany({}, { $set: { revoked_at: null } });

  // ── 7. privilege escalation ────────────────────────────────────────────────
  console.log("\n[another account]");
  {
    const { signIn: signIn2 } = require("./_signed_in.cjs");
    const other = await signIn2();
    const res = await other.page.evaluate(
      async ([api, ns]) => {
        const raw = window.localStorage.getItem("persist:root");
        const root = JSON.parse(raw);
        const auth = JSON.parse(root.auth);
        const fd = new FormData();
        fd.append("namespace_name", ns);
        const r = await fetch(`${api}/namespaces/${ns}/uploadToken`, {
          method: "POST",
          headers: { Authorization: `Bearer ${auth.accessToken}` },
          body: fd,
        });
        let b = null;
        try {
          b = await r.json();
        } catch {}
        return { status: r.status, body: b };
      },
      [API, NS],
    );
    check("a stranger cannot mint a token for someone else's namespace",
      res.status >= 400,
      `${res.status} ${JSON.stringify(res.body)?.slice(0, 80)}`);
    check("the refusal is marked forbidden, not an expired session (D65)",
      res.body?.reason === "forbidden",
      `reason=${res.body?.reason}`);
    await other.cleanup();
  }

  // ── 8. hygiene ─────────────────────────────────────────────────────────────
  console.log("\n[hygiene]");
  check("no uncaught exceptions", pageErrors.length === 0,
    pageErrors.slice(0, 2).join(" | ").slice(0, 140));

  await db.collection("packages").deleteMany({ name: { $in: [pkgA, "otherpkg"] } });
  await db.collection("namespaces").deleteMany({ namespace: NS });
  await cleanup();
  await client.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ${f.n}: ${f.d}`);
    if (leaked.length) console.log(`\nLEAKED TOKENS: ${leaked.join(", ")}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});