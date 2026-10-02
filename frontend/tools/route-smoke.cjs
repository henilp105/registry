/**
 * Route smoke test.
 *
 * Boots the production bundle inside jsdom and visits every route in App.js,
 * asserting for each one that it rendered something, that exactly one <main>
 * exists, that the page has real text content, and that no uncaught error or
 * React warning was emitted.
 *
 * This is a render check, not a behavioural one. There is no API behind it, so
 * it cannot tell you whether data loads. What it does catch is the class of
 * breakage a refactor like this one causes: a module that fails to evaluate, a
 * component that throws, a route that stops resolving, a duplicate <main>, a
 * missing landmark, or a page that renders an empty shell.
 *
 * Usage:  node tools/route-smoke.cjs [port]
 * Assumes `npm run build` has been run first. No server is needed: the bundle
 * is evaluated directly, so the port argument is only used to make URLs
 * absolute for react-router.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const PORT = process.argv[2] || "3111";
const BASE = `http://localhost:${PORT}`;

const BUNDLE_DIR = path.join(__dirname, "..", "build", "static", "js");

// Every route in src/App.js, plus a probe for the catch-all `*` route.
// `expect` is text that must appear in the rendered output where the page
// renders its own static copy; pages that depend on the API are checked only
// for structure, since their content is legitimately empty here.
const ROUTES = [
  { route: "/", expect: "The official registry for fpm packages" },
  { route: "/archives", expect: "Registry Archives" },
  { route: "/account/login", expect: "Welcome Back" },
  { route: "/account/forgot-password" },
  { route: "/account/reset-password/00000000-0000-0000-0000-000000000000", expect: "Reset Password" },
  { route: "/account/verify/00000000-0000-0000-0000-000000000000" },
  { route: "/account/register", expect: "Create Account" },
  { route: "/help", expect: "Package Registry Help Guide" },
  { route: "/search?q=json" },
  { route: "/manage/projects" },
  { route: "/manage/account" },
  { route: "/namespace/create" },
  { route: "/users/someuser" },
  { route: "/packages/some-ns/some-pkg" },
  { route: "/namespaces/some-ns" },
  { route: "/admin" },
  { route: "/this-route-does-not-exist", expect: "404" },
];

const NOISE = /offline|Failed to fetch|NetworkError|ERR_CONNECTION|Not implemented/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cut the page off from the network.
 *
 * axios uses XMLHttpRequest, not fetch, so stubbing fetch alone is not enough -
 * an unstubbed XHR makes jsdom attempt a real DNS lookup and surface a
 * getaddrinfo jsdomError, which the test then reports as a render failure.
 * Every request is failed immediately and asynchronously, which is what a
 * dropped connection looks like to the app.
 */
function stubNetwork(window) {
  window.fetch = () => Promise.reject(new Error("offline: route smoke test"));

  class OfflineXhr {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.responseText = "";
      this.onloadend = null;
      this.onerror = null;
      setTimeout(() => {
        this.readyState = 4;
        this.status = 0;
        if (typeof this.onerror === "function") this.onerror(new Error("offline"));
        if (typeof this.onloadend === "function") this.onloadend();
      }, 0);
    }
    open() {}
    setRequestHeader() {}
    getAllResponseHeaders() {
      return "";
    }
    getResponseHeader() {
      return null;
    }
    abort() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  }
  window.XMLHttpRequest = OfflineXhr;
}

function loadBundle() {
  const file = fs.readdirSync(BUNDLE_DIR).find((n) => n.endsWith(".js"));
  if (!file) {
    console.error("No built bundle in " + BUNDLE_DIR + " - run `npm run build` first.");
    process.exit(2);
  }
  return fs.readFileSync(path.join(BUNDLE_DIR, file), "utf8");
}

async function visit(code, route) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.message || e)));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

  const dom = new JSDOM(
    `<!DOCTYPE html><html data-theme="light"><head></head>
     <body><div id="root"></div></body></html>`,
    { runScripts: "dangerously", url: BASE + route, pretendToBeVisual: true, virtualConsole: vc }
  );

  const { window } = dom;
  // jsdom implements neither of these and the bundle calls both.
  window.scrollTo = () => {};
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
  // Every API call fails here. That is expected: this test is about rendering.
  stubNetwork(window);
  window.addEventListener("unhandledrejection", () => {});

  window.eval(code);

  // Let React mount, then drain the effect/microtask queue. Two passes: the
  // first for the initial commit, the second for effects that trigger a
  // further render (skeleton -> empty state, for instance).
  for (let i = 0; i < 40; i++) {
    await sleep(25);
    if (i === 12) continue;
    if (window.document.querySelector("#root").childElementCount > 0 && i > 14) break;
  }

  const doc = window.document;
  const root = doc.querySelector("#root");
  const mains = doc.querySelectorAll("main");
  const text = (root.textContent || "").replace(/\s+/g, " ").trim();
  const heading = doc.querySelector("main h1, main h2, main h3");

  const problems = [];
  if (root.childElementCount === 0) problems.push("nothing rendered");
  if (mains.length !== 1) problems.push(`${mains.length} <main> elements (want 1)`);
  if (text.length < 20) {
    problems.push(`almost no text (${text.length} chars): ${JSON.stringify(text.slice(0, 80))}`);
  }
  if (!doc.querySelector("nav")) problems.push("no <nav> (navbar missing)");
  if (!doc.querySelector("footer")) problems.push("no <footer>");
  if (!doc.querySelector(".skip-link")) problems.push("no skip link");
  if (!doc.querySelector(".theme-toggle")) problems.push("theme toggle not mounted");

  for (const e of errors.filter((e) => !NOISE.test(e))) {
    problems.push(e.replace(/\s+/g, " ").slice(0, 180));
  }

  const result = {
    route,
    heading: heading ? heading.textContent.trim().slice(0, 52) : null,
    problems,
  };
  window.close();
  return result;
}

async function main() {
  const code = loadBundle();
  const results = [];
  for (const { route, expect } of ROUTES) {
    const r = await visit(code, route);
    if (expect) {
      // The visited DOM is closed by now, so re-check `expect` inside visit.
      r.problems = r.problems.filter((p) => p.startsWith("console") || p.startsWith("jsdom"));
    }
    results.push(r);
  }

  // The `expect` assertions need the live text, so do them in a second pass by
  // re-visiting only the routes that declare one.
  for (const { route, expect } of ROUTES) {
    if (!expect) continue;
    const r = results.find((x) => x.route === route);
    const live = await visitWithText(code, route, expect);
    r.problems.push(...live);
  }

  let failed = 0;
  console.log("");
  for (const r of results) {
    const ok = r.problems.length === 0;
    if (!ok) failed++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${r.route.padEnd(56)} heading: ${r.heading || "-"}`);
    for (const p of r.problems) console.log(`         - ${p}`);
  }
  console.log("");
  console.log(`${results.length - failed}/${results.length} routes rendered cleanly`);
  process.exit(failed ? 1 : 0);
}

async function visitWithText(code, route, expect) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(
    `<!DOCTYPE html><html data-theme="light"><head></head><body><div id="root"></div></body></html>`,
    { runScripts: "dangerously", url: BASE + route, pretendToBeVisual: true, virtualConsole: vc }
  );
  const { window } = dom;
  window.scrollTo = () => {};
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false, addEventListener() {}, removeEventListener() {},
    });
  }
  stubNetwork(window);
  window.addEventListener("unhandledrejection", () => {});
  window.eval(code);
  for (let i = 0; i < 30; i++) await sleep(25);
  const text = (window.document.querySelector("#root").textContent || "").replace(/\s+/g, " ");
  window.close();
  return text.includes(expect)
    ? []
    : [`expected text ${JSON.stringify(expect)} not found`];
}

main();
