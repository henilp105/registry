#!/usr/bin/env node
/**
 * Review pass: the surface previous verification never reached.
 *
 *   node scripts/frontend_review.cjs [APP_BASE] [API_BASE]
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Every harness so far has driven the **happy path**: a seeded database, valid
 * requests, successful responses. That is how D49–D60 were found, and it is also
 * why a whole category went unexamined — what the UI does when things go wrong.
 *
 * Three gaps, all real:
 *
 *   1. **Five routes were never opened at all**: `/admin`, `/manage/projects`,
 *      `/namespace/create`, `/account/verify/:uuid` and
 *      `/account/reset-password/:uuid`. The browser audit covered 11 of the 16.
 *   2. **No error state had ever been rendered.** A registry whose API returns
 *      500, or 429 — which this migration *just* added — or vanishes entirely,
 *      is a different application from one that always answers 200. The 429 case
 *      is new as of the rate limiter and had never been seen by a human.
 *   3. **Only two viewport widths.** 1440 and 390. The 768px range, where a
 *      desktop grid usually breaks, was never rendered.
 *
 * Failures are injected with Playwright's request interception rather than by
 * standing up a second broken server: it targets exactly the frontend's error
 * handling, which is the thing under review, and it cannot perturb the live
 * database.
 */

const { chromium } = require("playwright");
const fs = require("node:fs");

const APP = process.argv[2] ?? "http://127.0.0.1:5173";
const API = process.argv[3] ?? "http://127.0.0.1:8787";
const OUT = "/tmp/opencode/review";

const findings = [];
const note = (severity, area, message) => {
  findings.push({ severity, area, message });
  console.log(`  ${severity.padEnd(7)} ${area.padEnd(22)} ${message}`);
};

/**
 * A check that can fail the run.
 *
 * Defect D115: several sections of this file printed PASS/FAIL to stdout and
 * never recorded the result, so the summary at the end could not be derived from
 * them and the process exited 0 regardless. `check` records a BUG on failure, so
 * a failing assertion is visible in `findings.json` and in the exit code rather
 * than only in a scrollback nobody reads.
 */
const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail: detail || "" });
  console.log(`  ${pass ? "PASS   " : "FAIL   "}${name}${detail ? " — " + detail : ""}`);
  if (!pass) note("BUG", "check", `${name}${detail ? ` — ${detail}` : ""}`);
};

/** Routes, including the five the earlier audit never opened. */
const ROUTES = [
  ["/", "home"],
  ["/search", "search"],
  ["/search?query=fortran", "search-with-query"],
  ["/packages/stdlib/json-fortran", "package-detail"],
  ["/packages/stdlib/json-fortran/0.10.0", "package-version"],
  // The *client* route is plural. The API path is singular
  // (/namespace/{ns}) -- a preserved legacy inconsistency, recorded in the
  // contract. Probing the API shape here yields a 404 that says nothing
  // about the app.
  ["/namespaces/stdlib", "namespace"],
  ["/namespace/create", "namespace-create"],
  ["/users/fortran-lang", "user-profile"],
  ["/archives", "archives"],
  ["/help", "help"],
  ["/admin", "admin"],
  ["/manage/account", "manage-account"],
  ["/manage/projects", "manage-projects"],
  ["/account/login", "login"],
  ["/account/register", "register"],
  ["/account/forgot-password", "forgot-password"],
  // The email-link routes, with a token-shaped parameter. These are only ever
  // reached from an email, so no harness had ever opened them.
  ["/account/verify/some-verification-token", "verify-email"],
  ["/account/reset-password/some-reset-token", "reset-password"],
  ["/packages/stdlib/does-not-exist", "package-404"],
  ["/users/no-such-user", "user-404"],
  ["/namespaces/no-such-namespace", "namespace-404"],
  ["/this/route/does/not/exist", "catch-all-404"],
];

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide", width: 1920, height: 1080 },
];

/** Inspect a rendered page for the things a status code cannot tell you. */
const PROBE = () => {
  const root = document.querySelector("#root");
  const text = (root?.innerText || "").trim();
  const main = document.querySelector("main");
  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };
  // Horizontal overflow: the classic responsive bug, invisible in a screenshot
  // unless you know to look for the scrollbar.
  const overflowing = [...document.querySelectorAll("body *")]
    .filter((el) => visible(el) && el.getBoundingClientRect().right > document.documentElement.clientWidth + 2)
    .slice(0, 3)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
  return {
    children: root ? root.children.length : 0,
    textLength: text.length,
    heading: document.querySelector("h1,h2")?.innerText?.slice(0, 70) ?? null,
    mains: document.querySelectorAll("main").length,
    // A crash boundary renders nothing at all.
    emptyMain: !!main && main.innerText.trim().length === 0,
    // Horizontal scroll on the document.
    docScrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowing,
    // Spinner left running after the request settled: a load state with no error
    // and no data is the worst thing a UI can show.
    spinners: [...document.querySelectorAll(".spinner-border, [role='progressbar']")].filter(visible).length,
    imgNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    inputNoLabel: [...document.querySelectorAll("input,select,textarea")].filter((el) => {
      if (el.type === "hidden") return false;
      const id = el.id;
      return !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") &&
        !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) &&
        !el.closest("label");
    }).length,
    buttonsNoName: [...document.querySelectorAll("button,a.btn")].filter((b) => {
      return visible(b) && !(b.innerText || "").trim() && !b.getAttribute("aria-label") && !b.title;
    }).length,
    // `href="#"` is only a defect outside a tablist. Inside one it is the correct
    // convention: a tab is not a navigation, and `href="#"` is what Bootstrap's
    // Tab emits. Verified on the package page -- role="tablist", role="tab" with
    // aria-selected and aria-controls, and role="tabpanel" with aria-labelledby.
    //
    // Elsewhere it means "an anchor that navigates via JavaScript", which
    // announces as pointing at "#" and breaks ctrl-click and open-in-new-tab.
    // That was 3 links in the navbar until they were changed to real `to=` hrefs.
    deadLinks: [...document.querySelectorAll("a[href='#']")]
      .filter((a) => !a.closest('[role="tablist"]'))
      .length,
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const consoleErrors = [];
  const failedRequests = [];

  // ── 1. every route, every viewport ────────────────────────────────────────
  console.log("\n[1] every route, every viewport");
  for (const viewport of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "light",
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => consoleErrors.push({ route: page.url(), error: String(e) }));
    page.on("response", (r) => {
      if (r.status() >= 500) failedRequests.push({ url: r.url(), status: r.status() });
    });

    for (const [route, label] of ROUTES) {
      try {
        await page.goto(APP + route, { waitUntil: "networkidle", timeout: 25000 });
      } catch (e) {
        note("ERROR", `${label}@${viewport.name}`, `navigation failed: ${e.message.split("\n")[0]}`);
        continue;
      }
      await page.waitForTimeout(400);
      const f = await page.evaluate(PROBE);

      if (f.children === 0) {
        note("BUG", `${label}@${viewport.name}`, "renders nothing at all — crash boundary");
      } else if (f.textLength < 15 && !label.includes("404")) {
        note("WARN", `${label}@${viewport.name}`, `almost no content (${f.textLength} chars)`);
      }
      if (f.mains === 0) note("WARN", `${label}@${viewport.name}`, "no <main> landmark");
      if (f.mains > 1) note("BUG", `${label}@${viewport.name}`, `${f.mains} <main> landmarks`);
      if (f.emptyMain) note("BUG", `${label}@${viewport.name}`, "<main> is empty after load");
      if (f.docScrollWidth > f.clientWidth + 2) {
        note("BUG", `${label}@${viewport.name}`,
          `horizontal overflow: scrollWidth ${f.docScrollWidth} > clientWidth ${f.clientWidth}; ${f.overflowing.join(", ")}`);
      }
      if (f.spinners > 0) note("WARN", `${label}@${viewport.name}`, `${f.spinners} spinner(s) still running after load`);
      if (f.imgNoAlt) note("A11Y", `${label}@${viewport.name}`, `${f.imgNoAlt} <img> without alt`);
      if (f.inputNoLabel) note("A11Y", `${label}@${viewport.name}`, `${f.inputNoLabel} form control without a label`);
      if (f.buttonsNoName) note("A11Y", `${label}@${viewport.name}`, `${f.buttonsNoName} button(s) with no accessible name`);
      if (f.deadLinks > 2) note("WARN", `${label}@${viewport.name}`, `${f.deadLinks} href="#" placeholder links`);
    }

    if (viewport.name === "tablet") {
      for (const [route, label] of [["/", "home"], ["/search", "search"], ["/packages/stdlib/json-fortran", "package-detail"]]) {
        await page.goto(APP + route, { waitUntil: "networkidle" });
        await page.screenshot({ path: `${OUT}/${label}-tablet.png`, fullPage: true });
      }
    }
    await ctx.close();
  }

  // ── 2. injected failures ───────────────────────────────────────────────────
  console.log("\n[2] injected API failures — what the user actually sees");
  let injected = 0;

  const FAILURES = [
    ["api-500", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"code":500,"message":"Internal server error"}' })],
    ["api-429", (route) => route.fulfill({
      status: 429, contentType: "application/json",
      headers: { "retry-after": "42", "x-ratelimit-limit": "100", "x-ratelimit-remaining": "0" },
      body: '{"code":429,"message":"Rate limit exceeded. Please retry after the interval in the Retry-After header."}',
    })],
    ["api-404", (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"code":404,"message":"Page not found"}' })],
    ["api-401", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"code":401,"message":"Unauthorized"}' })],
    ["api-down", (route) => route.abort("connectionrefused")],
    ["api-garbage", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "not json at all" })],
    ["api-null-body", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" })],
  ];

  const TARGETS = [
    ["/packages/stdlib/json-fortran", "package-detail"],
    ["/users/fortran-lang", "user-profile"],
    // The *client* route is plural. The API path is singular
  // (/namespace/{ns}) -- a preserved legacy inconsistency, recorded in the
  // contract. Probing the API shape here yields a 404 that says nothing
  // about the app.
  ["/namespaces/stdlib", "namespace"],
  ];

  for (const [name, handler] of FAILURES) {
    for (const [route, label] of TARGETS) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const thrown = [];
      let intercepted = 0;
      page.on("pageerror", (e) => thrown.push(String(e).split("\n")[0]));
      await page.route(`${API}/**`, (r) => { intercepted++; return handler(r); });
      try {
        await page.goto(APP + route, { waitUntil: "networkidle", timeout: 20000 });
      } catch { /* the point is what renders */ }
      await page.waitForTimeout(600);

      const f = await page.evaluate(PROBE);
      const tag = `${name}/${label}`;
      injected += intercepted;

      // A case where no request was intercepted proves nothing either way, so it
      // is excluded rather than counted as a pass.
      if (intercepted === 0) {
        note("WARN", tag, "no API request was intercepted -- this case proved nothing");
        await ctx.close();
        continue;
      }

      if (thrown.length) {
        note("BUG", tag, `uncaught exception: ${thrown[0].slice(0, 110)}`);
      }
      if (f.children === 0) {
        note("BUG", tag, "renders nothing — the error blanked the page");
      } else if (f.textLength < 20) {
        // An empty state with no message is worse than an error: the user cannot
        // tell "nothing here" from "something broke".
        note("BUG", tag, `shows ${f.textLength} chars and no explanation`);
      }
      if (f.spinners > 0) {
        note("BUG", tag, `spinner still running ${name === "api-down" ? "forever" : "after failure"}`);
      }

      if (name === "api-500" && label === "search") {
        await page.screenshot({ path: `${OUT}/error-500-search.png`, fullPage: true });
      }
      if (name === "api-429" && label === "search") {
        await page.screenshot({ path: `${OUT}/error-429-search.png`, fullPage: true });
      }
      if (name === "api-down" && label === "package-detail") {
        await page.screenshot({ path: `${OUT}/error-down-package.png`, fullPage: true });
      }
      await ctx.close();
    }
  }

  console.log(`\n  intercepted ${injected} API requests across the injected-failure matrix`);

  // ── 3. does the UI honour a 429's Retry-After? ────────────────────────────
  console.log("\n[3] 429 handling specifically");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    let sawRetryAfterInUi = false;
    await page.route(`${API}/**`, (route) =>
      route.fulfill({
        status: 429, contentType: "application/json",
        headers: { "retry-after": "42", "x-ratelimit-limit": "100", "x-ratelimit-remaining": "0" },
        body: '{"code":429,"message":"Rate limit exceeded. Please retry after the interval in the Retry-After header."}',
      }));
    await page.goto(APP + "/packages/stdlib/json-fortran", { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(600);
    const body = await page.evaluate(() => document.body.innerText);
    sawRetryAfterInUi = /rate limit|429|too many|slow down/i.test(body);
    if (!sawRetryAfterInUi) {
      note("WARN", "429 messaging",
        "the UI does not appear to mention rate limiting — a 429 would read as a generic failure");
    } else {
      console.log("  PASS    429 messaging         the UI names the problem");
    }
    await ctx.close();
  }

  // ── 4. console hygiene across the plain happy path ────────────────────────
  console.log("\n[4] console hygiene (happy path)");
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const collected = [];
    // The three not-found routes legitimately produce an API 404, which the
    // browser logs as a console error. That is the route working, so it is
    // excluded -- otherwise a real console error has to compete with three
    // expected ones on every run.
    //
    // Defect D115: two of these three strings did not match any route in ROUTES.
    // The list said "/packages/stdlib/nope" and "/users/nobody"; ROUTES says
    // "/packages/stdlib/does-not-exist" and "/users/no-such-user". So two of the
    // three intended exclusions were not in force and their 404s were counted as
    // console errors -- which would have made the check permanently noisy, and
    // therefore easy to disable.
    //
    // Built from ROUTES by matching the route *label*, so a route cannot be
    // renamed out of the exclusion list without this noticing.
    const EXPECTED_404 = new Set(
      ROUTES.filter(([, label]) => label.endsWith("-404")).map(([route]) => route),
    );
    check(
      "the expected-404 exclusions match real routes",
      EXPECTED_404.size === 3,
      `${EXPECTED_404.size} of 3 matched; every one must be a route that exists, or the filter silently stops filtering`,
    );

    // Defect D115: there was no `page.on("console", ...)` handler. `msgs` was
    // declared, never written, reset to length 0 on every iteration, and then
    // spread into `collected` -- so `unique.length === 0` was a constant and
    // "console clean across all 21 routes" printed unconditionally. The listener
    // is what makes the array mean anything.
    let currentRoute = null;
    page.on("console", (msg) => {
      // `error` only. `warning` and `info` are noise for this purpose; a
      // deprecation notice is not the defect class this section is looking for.
      if (msg.type() === "error") collected.push({ route: currentRoute, text: msg.text() });
    });

    let visited = 0;
    for (const [route] of ROUTES) {
      if (EXPECTED_404.has(route)) continue;
      currentRoute = route;
      visited += 1;
      await page.goto(APP + route, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(250);
    }

    const unique = [...new Map(collected.map((m) => [`${m.route}::${m.text}`, m])).values()];
    check(
      `no console errors across ${visited} routes`,
      unique.length === 0,
      unique.slice(0, 3).map((m) => `${m.route}: ${m.text}`).join(" | "),
    );
    for (const m of unique.slice(0, 8)) note("WARN", "console", `${m.route}: ${m.text}`);
    if (unique.length > 8) note("WARN", "console", `...and ${unique.length - 8} more`);
    await ctx.close();
  }

  await browser.close();

  const bySeverity = (s) => findings.filter((f) => f.severity === s).length;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`BUG ${bySeverity("BUG")}   WARN ${bySeverity("WARN")}   ERROR ${bySeverity("ERROR")}   A11Y ${bySeverity("A11Y")}`);
  console.log(`uncaught exceptions: ${consoleErrors.length}`);
  console.log(`5xx responses: ${failedRequests.length}`);

  // Defect D115: the file ended here with no `process.exit`, so it exited 0
  // unconditionally -- the console-hygiene check above could not fail the run,
  // let alone the process. It is now a real gate.
  const failedChecks = checks.filter((c) => !c.pass);
  console.log(`checks: ${checks.length - failedChecks.length}/${checks.length} passed`);

  fs.writeFileSync(
    `${OUT}/findings.json`,
    JSON.stringify({ findings, consoleErrors, failedRequests, checks }, null, 2),
  );
  console.log(`\nreport: ${OUT}/findings.json`);

  // Non-zero on a failed check, on an uncaught page exception, or on any 5xx.
  // All three are defects; none of them should be able to exit 0.
  process.exit(
    failedChecks.length === 0 && consoleErrors.length === 0 && failedRequests.length === 0 ? 0 : 1,
  );
})();
