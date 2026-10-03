#!/usr/bin/env node
/**
 * Drives the write journeys through the UI.
 *
 *   node scripts/write_journey.cjs [APP_BASE] [API_BASE]
 *
 * Requires `playwright` and `mongodb`:
 *   NODE_PATH=<repo>/worker/node_modules node scripts/write_journey.cjs
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `write_path_audit.mjs` exercises every write at the API level and passes 69/69.
 * That says the endpoints behave. It says nothing about whether the *forms* that
 * call them do: the field names, the client-side rules, what is sent on submit,
 * and whether a refusal is shown or swallowed.
 *
 * This is the same gap D65 sat in. That defect was invisible to every existing
 * check precisely because all of them tested one side of the browser boundary.
 * The authenticated views were rendered but never *acted on*.
 *
 * Namespace creation is the smallest write that produces durable state in two
 * collections, so it is the one that exercises the most machinery per line:
 * validation, the multipart body, the session header, and the response being
 * reflected back into the UI.
 */

const { MongoClient } = require("mongodb");
const { mongoUri, mongoDbName } = require("./_env.cjs");

const APP = process.argv[2] ?? "http://127.0.0.1:5173";
// See member_journey.cjs: _signed_in.cjs reads APP_BASE at module load,
// so it must agree with this file's origin before it is required, or the
// session token is written and read under different origins.
process.env.APP_BASE = APP;
const { signIn } = require("./_signed_in.cjs");
const API = process.argv[3] ?? "http://127.0.0.1:8787";
const URI = mongoUri("write_journey.cjs");

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

/** Waits for a condition rather than a duration — see _signed_in.cjs for why. */
async function until(fn, { tries = 40, gap = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, gap));
  }
  return null;
}

(async () => {
  const { page, USER, users, cleanup } = await signIn();
  const text = () => readText(page);
  const client = new MongoClient(URI);
  await client.connect();
    // Defect D120: hardcoded "fpmregistry_local" instead of `mongoDbName()`.
  // `MONGO_DB_NAME` is the variable the Worker itself reads and the one
  // .github/workflows/tests.yml sets, so with it set to anything else this
  // harness read a database the API under test was not writing to -- or
  // failed with "registration did not create ..." while the run was fine.
  // Four harnesses now resolve the name the same way member_journey.cjs
  // already did.
const db = client.db(mongoDbName());

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140));
  });

  // Every exchange is recorded so a failure can name its cause rather than leave
  // a symptom. Added after registration failed twice with only "no document".
  const calls = [];
  page.on("response", (r) => {
    if (r.url().includes(":8787")) calls.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "")}`);
  });

  const fill = async (n, v) => {
    const el = page.locator(`[name='${n}']`).first();
    await el.click();
    await el.fill(v);
  };
  const submit = async () => {
    const btn = page.locator("form button[type=submit]").first();
    await btn.click();
    try {
      await page.waitForFunction(
        () => {
          const b = document.querySelector("form button[type=submit]");
          return b && !b.disabled;
        },
        { timeout: 25000 },
      );
    } catch {
      /* the assertions below report the resulting state */
    }
    await page.waitForTimeout(500);
  };

  console.log(`\nwrite journeys through the UI, as ${USER}\n`);

  // ── 1. client-side rules ───────────────────────────────────────────────────
  console.log("[namespace: validation]");
  await page.goto(`${APP}/namespace/create`, { waitUntil: "networkidle" });
  await submit();
  let t = await text();
  check("an empty namespace is refused, naming the rule",
    /required|must|cannot|characters/i.test(t),
    (t.match(/[A-Z][^.]*(?:required|must|cannot)[^.]*\./i) ?? [""])[0]);

  const BAD = "has spaces & symbols!";
  await fill("namespace", BAD);
  await submit();
  t = await text();
  check("an illegal namespace name is refused",
    /invalid|only|allowed|character|format/i.test(t),
    (t.match(/[A-Z][^.]*(?:invalid|only|allowed|character|format)[^.]*\./i) ?? [""])[0]);
  check("no namespace was written for an invalid name",
    !(await db.collection("namespaces").findOne({ namespace: BAD })));

  const NS = `jt${Date.now().toString(36)}`;
  await fill("namespace", NS);
  await fill("namespace_description", "Written by scripts/write_journey.cjs");
  calls.length = 0;
  await submit();

  // ── 2. the write actually landed ───────────────────────────────────────────
  console.log("\n[namespace: valid submission]");
  const doc = await until(() => db.collection("namespaces").findOne({ namespace: NS }));
  check("the namespace was really written to the database", !!doc,
    doc ? `author=${String(doc.author)}` : `no document; API saw ${JSON.stringify(calls)}`);

  if (doc) {
    // The author must be this user's ObjectId, not their username as a string,
    // or every later ownership check silently fails. D57 was exactly that class
    // of bug on the package path.
    const me = await users.findOne({ username: USER });
    check("the author is stored as an ObjectId, not a username string",
      doc.author && typeof doc.author === "object" && String(doc.author) === String(me._id),
      `author=${JSON.stringify(doc.author)} (user _id=${String(me._id)})`);
    check("the description round-tripped",
      doc.description === "Written by scripts/write_journey.cjs",
      JSON.stringify(doc.description));
  }

  t = await text();
  check("the UI confirmed the write rather than sitting silent",
    /success|created|now|namespace/i.test(t), t.slice(0, 130).trim());

  // ── 3. the UI reflects it ──────────────────────────────────────────────────
  console.log("\n[namespace: visible in the UI]");
  await page.goto(`${APP}/namespaces/${NS}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  t = await text();
  check("the namespace page renders the name", t.includes(NS), NS);
  check("the namespace page shows the description that was stored",
    t.includes("Written by scripts/write_journey.cjs"));

  await page.goto(`${APP}/manage/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  t = await text();
  check("it appears on the owner's dashboard", t.includes(NS),
    t.includes(NS) ? NS : `not listed: ${t.slice(0, 130)}`);

  // ── 4. duplicate rejection ─────────────────────────────────────────────────
  console.log("\n[namespace: duplicate]");
  calls.length = 0;
  await page.goto(`${APP}/namespace/create`, { waitUntil: "networkidle" });
  await fill("namespace", NS);
  await fill("namespace_description", "Second attempt, same name");
  await submit();
  await page.waitForTimeout(900);
  t = await text();
  check("a duplicate name is refused with an explanation",
    /exist|taken|already|duplicate/i.test(t),
    (t.match(/[A-Z][^.]*(?:exist|taken|already|duplicate)[^.]*\./i) ?? [""])[0] || t.slice(0, 120));
  const dupes = await db.collection("namespaces").countDocuments({ namespace: NS });
  check("no second document was created", dupes === 1, `${dupes} documents named ${NS}`);

  // ── 5. hygiene ─────────────────────────────────────────────────────────────
  console.log("\n[hygiene]");
  check("no uncaught exceptions during the write journeys", pageErrors.length === 0,
    pageErrors.slice(0, 2).join(" | ").slice(0, 150));
  const realConsole = [...new Set(consoleErrors)].filter(
    (e) => !/status of 40[13]/.test(e) && !/Failed to load resource/.test(e),
  );
  if (realConsole.length) for (const e of realConsole.slice(0, 4)) console.log(`         console: ${e}`);
  check("no unexpected console errors", realConsole.length === 0, `${realConsole.length}`);

  await db.collection("namespaces").deleteMany({ namespace: NS });
  await cleanup();
  await client.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ${f.n}: ${f.d}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});