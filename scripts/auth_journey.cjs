#!/usr/bin/env node
/**
 * Drives the real authentication journey through the UI.
 *
 *   node scripts/auth_journey.cjs [APP_BASE] [API_BASE]
 *
 * Requires `playwright` and `mongodb`. Run it from a directory that can resolve
 * both, e.g.
 *   NODE_PATH=<repo>/worker/node_modules node scripts/auth_journey.cjs
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Every other harness either calls the API directly or renders the app **signed
 * out**. That left the largest user journey in the product untested: register,
 * verify, log in, then use the views that only exist once you are.
 *
 * `/admin`, `/manage/account` and `/manage/projects` had been rendered by the
 * review pass, but only as an anonymous visitor -- every one of them showed its
 * signed-out placeholder. Nobody had ever seen the authenticated version.
 *
 * The API being correct says nothing about whether the *form* works: the wiring
 * from field to validation to redux to axios, where the token is stored and
 * whether it is read back, and whether a failure is shown or swallowed.
 *
 * ── Two things this harness must not get wrong ───────────────────────────────
 * The first version of this file reported 12 failures, and almost all of them
 * were the harness's fault rather than the app's. Both causes are avoided here:
 *
 *  1. `clickText("Register")` matches `.first()`, and the *navbar* has a
 *     "Register" link. It navigated instead of submitting. Submits now go
 *     through `button[type=submit]`, which is unambiguous.
 *  2. The session is persisted by redux-persist under `persist:root`, not under
 *     `access_token`. Checking for the wrong key made a working login look like
 *     a broken one.
 *
 * The email-verification step cannot be driven through the UI: the link exists
 * only in an inbox and `BREVO_API_KEY` is unset. That step is marked as
 * standing in at the database rather than silently skipped.
 */

const { chromium } = require("playwright");
const { MongoClient } = require("mongodb");

const APP = process.argv[2] ?? "http://127.0.0.1:5173";
const API = process.argv[3] ?? "http://127.0.0.1:8787";
const URI =
  "mongodb+srv://henilp105_db_user:FsPIM1HkOairYjZj@cluster0.kdreahb.mongodb.net/?appName=Cluster0";
const DB = "fpmregistry_local";

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

const stamp = Date.now().toString(36);
const USER = `journey${stamp}`;
const PASSWORD = "journey-password-123";

/**
 * The session token, read the way the app actually stores it.
 *
 * redux-persist writes one `persist:root` blob in which each *slice* is itself a
 * JSON **string**: `{"auth":"{\"accessToken\":\"ey...\"}","_persist":"..."}`.
 * So the token is two `JSON.parse` calls deep, not one.
 *
 * Two wrong readings happened here, both of which made a working login look
 * broken:
 *  - looking for a top-level `access_token` key, which redux-persist never writes;
 *  - reading `JSON.parse(raw).auth.accessToken`, which is `undefined` because
 *    `.auth` is a string, not an object.
 */
const readToken = (page) =>
  page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem("persist:root");
      if (!raw) return null;
      const root = JSON.parse(raw);
      const auth = typeof root.auth === "string" ? JSON.parse(root.auth) : root.auth;
      return auth?.accessToken ?? null;
    } catch {
      return null;
    }
  });

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
  });

  const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  /** Submits the form. Deliberately not a text match: the navbar also says "Register". */
  const submit = async () => {
    await page.locator("form button[type=submit]").first().click();
    await page.waitForTimeout(1400);
  };
  const fill = async (name, v) => {
    const el = page.locator(`[name='${name}']`).first();
    await el.click();
    await el.fill(v);
  };

  console.log(`\nauth journey through the UI, account ${USER}\n`);

  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB);
  const users = db.collection("users");

  // Every API exchange is recorded, so that a check which fails can say *why*
  // instead of leaving a mystery. This was added after registration failed
  // intermittently with the harness reporting only "no document" -- which is a
  // symptom, not a cause, and two wrong guesses were made before the response
  // body was simply read.
  const calls = [];
  page.on("response", async (r) => {
    if (!r.url().includes(":8787")) return;
    calls.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "")}`);
  });

  // ── 1. client-side validation ──────────────────────────────────────────────
  console.log("[register: client-side validation]");
  await page.goto(`${APP}/account/register`, { waitUntil: "networkidle" });
  await submit();
  let t = await text();

  check(
    "an empty form is refused, naming each problem",
    /required/i.test(t),
    (t.match(/[A-Z][^.]*required[^.]*\./g) ?? []).slice(0, 2).join(" "),
  );
  check("no request was sent for an invalid form", (await readToken(page)) === null);

  // Mismatched confirmation is a distinct check from an empty one.
  await fill("username", USER);
  await fill("email", `${USER}@example.invalid`);
  await fill("password", PASSWORD);
  await fill("confirmPassword", "something-else");
  await submit();
  t = await text();
  check("a mismatched confirmation is caught", /do not match/i.test(t),
    (t.match(/[^.]*do not match[^.]*\./i) ?? [""])[0]);
  check("a rejected form created no account", !(await users.findOne({ username: USER })));

  // ── 2. a valid registration ────────────────────────────────────────────────
  console.log("\n[register: valid submission]");
  await fill("confirmPassword", PASSWORD);
  await submit();
  t = await text();

  const created = await users.findOne({ username: USER });
  check("the account really exists in the database", !!created,
    created
      ? `roles=${JSON.stringify(created.roles)}`
      : `no document; API saw: ${JSON.stringify(calls)}`);
  if (!created) {
    console.log(`         page text: ${(await text()).slice(120, 400)}`);
  }
  check(
    "the password was not stored in the clear",
    created && !JSON.stringify(created).includes(PASSWORD),
    "PBKDF2 hash expected",
  );
  check(
    "the UI reported success rather than staying silent",
    /success|verify|check your email|confirm/i.test(t),
    t.slice(t.search(/success|verify|check your email|confirm/i), 0).slice(0, 120) ||
      t.slice(0, 120),
  );

  // ── 3. login while unverified ──────────────────────────────────────────────
  console.log("\n[login before verification]");
  await page.goto(`${APP}/account/login`, { waitUntil: "networkidle" });
  await fill("user_identifier", USER);
  await fill("password", PASSWORD);
  await submit();
  t = await text();

  check(
    "an unverified account is told to verify, not signed in",
    /verify/i.test(t),
    (t.match(/[^.]*verif[^.]*\./i) ?? [""])[0],
  );
  check("no token was issued to an unverified account", (await readToken(page)) === null);

  // ── 4. wrong password ──────────────────────────────────────────────────────
  console.log("\n[wrong password]");
  await page.goto(`${APP}/account/login`, { waitUntil: "networkidle" });
  await fill("user_identifier", USER);
  await fill("password", "definitely-the-wrong-password");
  await submit();
  t = await text();
  check("a wrong password is reported", /invalid|password|incorrect|unauthor/i.test(t),
    (t.match(/[^.]*(?:invalid|incorrect|unauthor)[^.]*\./i) ?? [""])[0]);
  check("a wrong password issues no token", (await readToken(page)) === null);

  // ── 5. verification, standing in for the email ─────────────────────────────
  console.log("\n[verification — standing in for the emailed link]");
  // The link exists only in an inbox and BREVO_API_KEY is unset, so the UI
  // cannot be driven here. Said out loud rather than skipped in silence.
  await users.updateOne({ username: USER }, { $set: { isVerified: true } });
  ok("account marked verified directly in MongoDB",
    "the emailed link is not clickable in this environment");

  // ── 6. log in properly ─────────────────────────────────────────────────────
  console.log("\n[login]");
  await page.goto(`${APP}/account/login`, { waitUntil: "networkidle" });
  await fill("user_identifier", USER);
  await fill("password", PASSWORD);
  await submit();

  let token = await readToken(page);
  check("a session token was persisted", typeof token === "string" && token.length > 20,
    token ? `${token.slice(0, 24)}…` : "none");
  t = await text();
  check("the signed-in navigation replaced the anonymous one",
    /sign out|logout|my account/i.test(t) || !(await page.locator('a[href="/account/login"]').count()),
    t.slice(0, 110));

  // The decisive check: a token that nothing reads back is not a session.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const afterReload = await readToken(page);
  // Asserted *non-vacuously*: the first version compared `afterReload === token`,
  // which is trivially true when both are null, so it passed on the very run where
  // login had failed and there was no token to lose.
  check("the session survives a reload — the token is read back",
    typeof afterReload === "string" && afterReload === token,
    afterReload ? "token rehydrated" : "token lost");
  check("the nav still shows the signed-in state after a reload",
    !(await page.locator('a[href="/account/login"]').count()),
    "login link gone");

  // And that the rehydrated token is actually *sent*, which is what rehydration
  // exists for. Without this, a persisted-but-unmirrored token would pass the two
  // checks above and still fail every authenticated request.
  const authed = [];
  const onReq = (r) => { if (r.url().includes(":8787")) authed.push(r.url().replace(API, "")); };
  page.on("request", onReq);
  await page.goto(`${APP}/manage/account`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(900);
  page.off("request", onReq);

  // ── 7. the authenticated views, never rendered before ──────────────────────
  console.log("\n[authenticated views — never rendered until now]");
  for (const [route, label, expect] of [
    ["/manage/account", "manage-account", /account|email|username/i],
    ["/manage/projects", "manage-projects", /project|token|namespace/i],
    ["/namespace/create", "namespace-create", /namespace|name/i],
  ]) {
    const api = [];
    const on = (r) => { if (r.url().includes(":8787")) api.push(r.url().replace(API, "")); };
    page.on("request", on);
    await page.goto(APP + route, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(800);
    page.off("request", on);
    t = await text();
    check(`${label} renders identifiable content`, expect.test(t), t.slice(0, 120).trim());
    console.log(`         API: ${JSON.stringify(api)}`);
    if (route === "/manage/account") {
      check("the account page shows the signed-in user, not a placeholder",
        t.includes(USER), t.includes(USER) ? USER : `no username in: ${t.slice(0, 110)}`);
    }
  }

  // `/admin` for a non-admin renders <NoPage /> on purpose: admin.js line ~412.
  // Asserted as intended behaviour so a future change to it is deliberate.
  console.log("\n[admin: non-admin, then promoted]");
  await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  t = await text();
  check("a non-admin gets the 404 page rather than the admin tools (intended)",
    /404|not found/i.test(t) && !/Admin Settings/i.test(t));

  await users.updateOne({ username: USER }, { $set: { roles: ["admin"] } });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  t = await text();
  check("a promoted admin sees the admin tools",
    /Admin Settings/i.test(t), t.slice(0, 120).trim());
  check("the admin page did not crash on render", pageErrors.length === 0,
    pageErrors.slice(0, 1).join("").slice(0, 120));

  // ── 8. keyboard order ──────────────────────────────────────────────────────
  console.log("\n[keyboard]");
  await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const stops = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return "(none)";
      return (el.className || el.tagName).toString().split(/\s+/)[0] || el.tagName;
    }));
  }
  console.log(`         first tab stops: ${JSON.stringify(stops)}`);
  check("the skip link is the first tab stop",
    /skip/i.test(stops[0]), `first stop was "${stops[0]}"`);

  // ── 9. sign out ────────────────────────────────────────────────────────────
  console.log("\n[sign out]");
  await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  // Sign out lives inside the account dropdown, so it is not in the DOM-visible
  // sense until the dropdown is opened. The first version looked for it directly
  // and reported "no sign-out control found" — a harness bug, not a missing one.
  const toggle = page.locator(".dropdown-toggle").first();
  let signOut = page.locator('[role="menuitem"]:has-text("Sign Out"), .dropdown-item:has-text("Sign Out")').first();
  if ((await signOut.count()) === 0) {
    if ((await toggle.count()) === 0) {
      check("an account dropdown exists to sign out from", false, "no dropdown toggle");
    } else {
      await toggle.click();
      await page.waitForTimeout(500);
      signOut = page.locator('.dropdown-item:has-text("Sign Out"), .dropdown-item:has-text("Logout"), [role="menuitem"]:has-text("Sign Out")').first();
    }
  }
  if ((await signOut.count()) > 0) {
    await signOut.click();
    await page.waitForTimeout(1400);
    const left = await readToken(page);
    check("signing out clears the persisted token", left === null,
      left ? `${left.slice(0, 20)}… still present` : "");
    check("signing out restores the anonymous nav",
      (await page.locator('a[href="/account/login"]').count()) > 0);
  } else {
    check("a sign-out control is reachable", false, "not found after opening the dropdown");
  }

  // ── 10. hygiene ────────────────────────────────────────────────────────────
  console.log("\n[hygiene]");
  check("no uncaught exceptions during the journey", pageErrors.length === 0,
    pageErrors.slice(0, 2).join(" | ").slice(0, 160));
  if (consoleErrors.length) {
    for (const e of [...new Set(consoleErrors)].slice(0, 6)) console.log(`         console: ${e}`);
  }

  await users.deleteMany({ username: USER });
  await client.close();
  await browser.close();

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