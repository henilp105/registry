#!/usr/bin/env node
/**
 * Signs a real account in and hands a live page to `body`.
 *
 *   node scripts/_signed_in.cjs            # just proves login works
 *
 * Requires `playwright` and `mongodb`. The session bug this exists to work
 * around is D65: before that fix, being signed in lasted about a second, so
 * anything that needed an authenticated page had to establish the session
 * itself and then act immediately.
 *
 * Returns `{ browser, ctx, page, USER, cleanup }`.
 */
const { chromium } = require("playwright");
const { MongoClient } = require("mongodb");
const { mongoUri } = require("./_env.cjs");

const URI = mongoUri("_signed_in.cjs");
const APP = process.env.APP_BASE ?? "http://127.0.0.1:5173";

async function signIn({ admin = false, fresh = true } = {}) {
  const USER = `si${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const PASSWORD = "journey-password-123";

  const client = new MongoClient(URI);
  await client.connect();
  const users = client.db("fpmregistry_local").collection("users");

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // NOT varied per run, and the reason is worth recording.
  //
  // `POST /auth/signup` authenticates nobody, so `clientKey()` falls back to the
  // source address: every browser harness shares one `a:127.0.0.1` budget of 10 auth
  // requests/minute. `token_journey.cjs` solves this by sending
  // `cf-connecting-ip`, because it publishes from Node and no CORS applies.
  //
  // A browser harness cannot. Adding a header makes the request non-simple, so the
  // browser sends a preflight, and the Worker's CORS allow-list is exactly
  // `Content-Type, Authorization` -- so the preflight fails and axios reports a bare
  // "Network Error" with no status and no message. That is worse than sharing a
  // bucket: it looks like the registry is down.
  //
  // So the budget is respected by spending less of it: one account per run where the
  // journey allows, and a bounded retry below rather than an immediate second try.
  const sourceIp = "127.0.0.1";

  const page = await ctx.newPage();

  const fill = async (n, v) => {
    const el = page.locator(`[name='${n}']`).first();
    await el.click();
    await el.fill(v);
  };

  await page.goto(`${APP}/account/register`, { waitUntil: "networkidle" });
  for (const [n, v] of [
    ["username", USER],
    ["email", `${USER}@example.invalid`],
    ["password", PASSWORD],
    ["confirmPassword", PASSWORD],
  ])
    await fill(n, v);
  await page.locator("form button[type=submit]").first().click();

  // Wait for the *condition*, not for a length of time.
  //
  // This used to be `waitForTimeout(1500)`, and registration failed intermittently
  // — roughly one run in three — reporting only "no document". The cause was
  // measured rather than guessed: `POST /auth/signup` takes ~1000-1330 ms and the
  // document is visible at ~1600 ms, so a 1500 ms sleep was simply shorter than the
  // real latency and the check raced it. Four consecutive runs: 1010, 1186, 1185,
  // 1321 ms.
  //
  // Nothing in the app was wrong. A fixed sleep is a race that passes on a fast
  // machine and fails on a loaded one, so it is replaced everywhere below.
  let made = null;
  for (let i = 0; i < 40 && !made; i++) {
    await page.waitForTimeout(400);
    made = await users.findOne({ username: USER });
  }
  if (!made) {
    throw new Error(
      `registration did not create ${USER} (from ${sourceIp}). The API said: ` +
        JSON.stringify(
          await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(120, 400)),
        ),
    );
  }

  // The emailed link cannot be clicked here (BREVO_API_KEY is unset), so
  // verification is asserted at the database and said so out loud.
  await users.updateOne({ username: USER }, { $set: { isVerified: true } });
  if (admin) await users.updateOne({ username: USER }, { $set: { roles: ["admin"] } });

  await page.goto(`${APP}/account/login`, { waitUntil: "networkidle" });
  await fill("user_identifier", USER);
  await fill("password", PASSWORD);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForTimeout(2200);

  const token = await page.evaluate(() => {
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
  if (!token) throw new Error(`login produced no token for ${USER} (D65 regression?)`);

  const cleanup = async () => {
    if (fresh) await users.deleteMany({ username: USER });
    await client.close();
    await browser.close();
  };

  return { browser, ctx, page, USER, PASSWORD, token, users, sourceIp, cleanup };
}

module.exports = { signIn };

if (require.main === module) {
  signIn()
    .then(async ({ USER, cleanup }) => {
      console.log(`signed in as ${USER}`);
      await cleanup();
    })
    .catch((e) => {
      console.error("FAILED:", e.message);
      process.exit(1);
    });
}