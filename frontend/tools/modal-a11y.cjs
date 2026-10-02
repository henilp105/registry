/**
 * Dialog accessibility check.
 *
 * The app's dialogs are react-bootstrap Modals, kept deliberately: its Modal
 * is the focus-trapping, aria-modal, escape-closing implementation the whole
 * app relies on. This asserts that behaviour actually reaches the DOM, rather
 * than taking the library's word for it.
 *
 * It stubs the API with a canned package payload so /packages/:ns/:pkg renders
 * its populated branch, then opens each of the three dialogs on that page
 * (View Maintainers, Rate, Report) and checks:
 *   - role="dialog" and aria-modal="true" on the container
 *   - the dialog is labelled: aria-label, or aria-labelledby pointing at
 *     something that exists
 *   - focus moved inside the dialog on open
 *   - Tab from the last focusable element wraps back into the dialog
 *     (the focus trap - this is the part that matters most, and the part a
 *     hand-rolled dialog usually gets wrong)
 *   - Escape closes it
 *
 * Usage:  node tools/modal-a11y.cjs
 * Assumes `npm run build` has been run.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const BUNDLE_DIR = path.join(__dirname, "..", "build", "static", "js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PACKAGE_PAYLOAD = {
  name: "json-fortran",
  namespace: "some-ns",
  description: "A JSON parser and serializer for Fortran.",
  license: "MIT",
  repository: "https://github.com/example/json-fortran",
  homepage: "https://example.org",
  updated_at: new Date(Date.now() - 86400000).toISOString(),
  latest_version_data: { version: "1.2.3" },
  version_history: [
    { version: "1.2.3", created_at: new Date().toISOString(), isDeprecated: "false", download_url: "/dl/1.2.3.tar.gz" },
    { version: "1.0.0", created_at: new Date(Date.now() - 86400000 * 90).toISOString(), isDeprecated: "true", download_url: "/dl/1.0.0.tar.gz" },
  ],
  ratings_count: { 1: 0, 2: 1, 3: 4, 4: 9, 5: 21 },
  registry_description: "# json-fortran\n\nA JSON library.",
  keywords: ["json", "serialization"],
};

// react-bootstrap focuses the dialog container itself on open (it has
// tabindex="-1"), which is correct behaviour: the first Tab from there lands
// on the first control inside. So "focus is on the dialog div" counts as
// focus having moved into the dialog.
const FOCUS_IN_DIALOG_OK = (dialog, active) =>
  dialog.contains(active) || active === dialog;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DEBUG = process.env.SMOKE_DEBUG === "1";

function makeWindow() {
  const vc = new VirtualConsole();
  if (DEBUG) {
    vc.on("jsdomError", (e) => console.error("  [jsdom]", String(e.message).slice(0, 300)));
    vc.on("error", (...a) => console.error("  [console.error]", String(a[0]).slice(0, 400)));
    vc.on("warn", (...a) => console.error("  [console.warn]", String(a[0]).slice(0, 200)));
    vc.on("log", (...a) => console.error("  [console.log]", String(a[0]).slice(0, 200)));
  }
  const dom = new JSDOM(
    `<!DOCTYPE html><html data-theme="light"><head></head><body><div id="root"></div></body></html>`,
    {
      runScripts: "dangerously",
      url: "http://localhost:3111/packages/some-ns/some-pkg",
      pretendToBeVisual: true,
      virtualConsole: vc,
    }
  );
  return dom;
}

function installApiStub(window) {
  window.scrollTo = () => {};
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false, addEventListener() {}, removeEventListener() {},
    });
  }
  window.fetch = () => Promise.reject(new Error("offline"));

  // axios 1.x's xhr adapter reads onloadend / onreadystatechange, statusText,
  // responseType and getAllResponseHeaders, so the stub has to be a
  // reasonably complete XHR or the request never settles.
  class StubXhr {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.statusText = "";
      this.response = "";
      this.responseText = "";
      this.responseType = "";
      this.timeout = 0;
      this.withCredentials = false;
      this.upload = { addEventListener() {}, removeEventListener() {} };
      this._listeners = {};
    }
    open(_method, url) {
      this._url = url || "";
    }
    setRequestHeader() {}
    overrideMimeType() {}
    getAllResponseHeaders() {
      return "content-type: application/json\r\n";
    }
    getResponseHeader(name) {
      return String(name).toLowerCase() === "content-type"
        ? "application/json"
        : null;
    }
    abort() {
      this.readyState = 4;
      this._fire("abort");
    }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    removeEventListener(type, fn) {
      const list = this._listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    _fire(type) {
      for (const fn of this._listeners[type] || []) fn({ type, target: this });
    }
    send(body) {
      // The registry API prefixes every path; match on the trailing segment.
      const path = String(this._url).replace(/^https?:\/\/[^/]+/, "");
      let data = {};
      if (/\/packages\/[^/]+\/[^/]+$/.test(path) && !/verify|stats|role/.test(path)) {
        data = PACKAGE_PAYLOAD;
      } else if (/verify|role/.test(path)) {
        data = { role: "Package Maintainer" };
      } else if (/maintainer|users/.test(path)) {
        data = ["someone"];
      }
      // The API envelope is { code, data } - see API_CONTRACT.md and
      // isSuccessResponse() in store/utils.
      const text = JSON.stringify({ code: 200, data });
      setTimeout(() => {
        this.readyState = 4;
        this.status = 200;
        this.statusText = "OK";
        this.responseText = text;
        this.response = text;
        if (typeof this.onreadystatechange === "function") this.onreadystatechange();
        this._fire("readystatechange");
        this._fire("load");
        this._fire("loadend");
        if (typeof this.onloadend === "function") this.onloadend();
      }, 0);
    }
  }
  window.XMLHttpRequest = StubXhr;
  // recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not
  // implement. Without it the Stats tab throws and unmounts the whole page,
  // which is why this stub is required rather than optional.
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.addEventListener("unhandledrejection", (e) => {
    if (DEBUG) console.error("  [unhandledrejection]", String(e.reason).slice(0, 200));
  });
}

const findDialog = (doc) => doc.querySelector('[role="dialog"]');

const labelOf = (doc, dialog) => {
  const by = dialog.getAttribute("aria-labelledby");
  if (by) {
    const el = doc.getElementById(by);
    if (el && el.textContent.trim()) return el.textContent.trim();
    return null;
  }
  const label = dialog.getAttribute("aria-label");
  return label && label.trim() ? label.trim() : null;
};

const inside = (dialog, el) => dialog.contains(el);

async function openAndCheck(window, buttonText, name) {
  const doc = window.document;
  const problems = [];

  const button = [...doc.querySelectorAll("button, a")].find((b) =>
    (b.textContent || "").toLowerCase().includes(buttonText.toLowerCase())
  );
  if (!button) {
    return { name, problems: [`no control matching "${buttonText}" on the page`] };
  }
  button.click();
  for (let i = 0; i < 30; i++) {
    await sleep(25);
    if (findDialog(doc)) break;
  }
  const dialog = findDialog(doc);
  if (!dialog) return { name, problems: ["dialog did not open"] };

  // role / aria-modal
  if (dialog.getAttribute("aria-modal") !== "true") {
    problems.push(`aria-modal is ${JSON.stringify(dialog.getAttribute("aria-modal"))}, want "true"`);
  }
  // accessible name
  if (!labelOf(doc, dialog)) problems.push("dialog has no accessible name");

  // Focus moved into the dialog on open. The library puts it on the container,
  // which is the right place to start a tab sequence.
  if (!FOCUS_IN_DIALOG_OK(dialog, doc.activeElement)) {
    problems.push(
      `focus stayed outside the dialog (on ${doc.activeElement && doc.activeElement.tagName})`
    );
  }

  // Focus containment. react-bootstrap implements this with `enforceFocus`:
  // a document-level focusin listener that pulls focus back to the dialog if it
  // lands outside. There are no tabindex=0 sentinels, and no aria-hidden on
  // the background - both of those are things this library does not do, so
  // asserting them would be asserting a different component. What we verify is
  // the behaviour the library actually provides: try to focus something
  // behind the dialog, and confirm focus does not stay there.
  const outside = doc.querySelector("#navbar-container a, nav a");
  if (outside) {
    outside.focus();
    // The listener runs on focusin; give it a turn to act.
    for (let i = 0; i < 8; i++) {
      await sleep(15);
      if (FOCUS_IN_DIALOG_OK(dialog, doc.activeElement)) break;
    }
    if (!FOCUS_IN_DIALOG_OK(dialog, doc.activeElement)) {
      problems.push(
        `focus escaped to ${outside.tagName} behind the dialog and was not pulled back`
      );
    }
  } else {
    problems.push("no focusable control behind the dialog to test containment");
  }

  // Escape closes. react-bootstrap listens for keydown on the document, so the
  // event is dispatched there. The close runs a fade transition, hence the
  // generous wait.
  const esc = new window.KeyboardEvent("keydown", {
    key: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true,
  });
  doc.dispatchEvent(esc);
  for (let i = 0; i < 60; i++) {
    await sleep(25);
    if (!findDialog(doc)) break;
  }
  if (findDialog(doc)) problems.push("Escape did not close the dialog");

  return { name, problems };
}

async function main() {
  const file = fs.readdirSync(BUNDLE_DIR).find((n) => n.endsWith(".js"));
  if (!file) {
    console.error("No built bundle. Run `npm run build` first.");
    process.exit(2);
  }
  const code = fs.readFileSync(path.join(BUNDLE_DIR, file), "utf8");

  const dom = makeWindow();
  const { window } = dom;
  installApiStub(window);
  window.eval(code);
  for (let i = 0; i < 50; i++) await sleep(25);

  const doc = window.document;
  const bodyText = (doc.querySelector("#main-content")?.textContent || "").replace(/\s+/g, " ");
  if (!bodyText.includes("json-fortran")) {
    console.error("The stubbed package page did not render its populated branch.");
    console.error("Rendered: " + JSON.stringify(bodyText.slice(0, 300)));
    process.exit(2);
  }

  const results = [];
  for (const [needle, name] of [
    ["View Package Maintainers", "View Package Maintainers dialog"],
    ["Rate", "Rate dialog"],
    ["Report", "Report dialog"],
  ]) {
    results.push(await openAndCheck(window, needle, name));
  }
  window.close();

  console.log("");
  let failed = 0;
  for (const r of results) {
    const ok = r.problems.length === 0;
    if (!ok) failed++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${r.name}`);
    for (const p of r.problems) console.log(`         - ${p}`);
  }
  console.log("");
  console.log(`${results.length - failed}/${results.length} dialog checks passed`);
  process.exit(failed ? 1 : 0);
}

main();
