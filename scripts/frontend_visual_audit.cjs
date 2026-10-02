/**
 * Browser verification of the frontend, in both colour schemes.
 *
 *   npx playwright install chromium        # once
 *   cd frontend && npm run build
 *   node ../scripts/serve_build.cjs . 5173     # any static server with SPA fallback
 *   npx wrangler dev                       # the API on :8787
 *   node scripts/frontend_visual_audit.cjs
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The redesign shipped a contrast table of 53 measured pairs. Every one of them
 * was correct, and the dark mode was still broken.
 *
 * The navbar rendered black-on-black at **1.11:1** in the dark theme, failing
 * WCAG AA for body text, large text *and* UI components. Separately the Register
 * CTA had no background at all, because Bootstrap's `.nav-link { background: 0 0 }`
 * shorthand reset `background-color` and won on source order -- white text on a
 * white page, 1.0:1.
 *
 * Neither is detectable by auditing a token file. The tokens were right; the
 * defects lived in the cascade, in a framework the theme does not own. Only
 * reading computed styles off a rendered page finds them.
 *
 * So this measures the rendered DOM: contrast from `getComputedStyle` on real
 * elements in both schemes, across two viewports, plus the structural facts a
 * screenshot alone will not tell you -- empty canvases, glyphs that failed to
 * load, duplicate `<main>`, unhandled exceptions and failed requests.
 *
 * Not wired into CI: it needs a browser and a running API, and the free GitHub
 * Actions minutes are better spent elsewhere. Run it before a release.
 *
 * `frontend/public/index.html` and `src/theme/theme.js` are asserted separately
 * in `.github/workflows/worker.yml` (`theme-contract`), because those two copies
 * of the theme writer have to stay in sync and once did not.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8787";
const OUT = "/tmp/opencode/shots";

const ROUTES = [
  ["/", "home"],
  ["/search", "search"],
  ["/packages/stdlib/json-fortran", "package-detail"],
  ["/namespace/stdlib", "namespace"],
  ["/archives", "archives"],
  ["/help", "help"],
  ["/account/login", "login"],
  ["/account/register", "register"],
  ["/account/forgot-password", "forgot-password"],
  ["/users/fortran-lang", "user-profile"],
  ["/manage/account", "manage-account"],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const report = { routes: [], console: [], pageErrors: [], failedRequests: [], checks: [] };

  const check = (name, pass, detail) => {
    report.checks.push({ name, pass, detail });
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  };

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: scheme,
        deviceScaleFactor: 1,
      });

      for (const [route, label] of ROUTES) {
        const page = await context.newPage();
        const logs = [];
        const errors = [];
        const failed = [];

        page.on("console", (m) => {
          if (m.type() === "error" || m.type() === "warning") {
            logs.push(`[${m.type()}] ${m.text()}`);
          }
        });
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("requestfailed", (r) =>
          failed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`),
        );
        page.on("response", (r) => {
          if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
        });

        let status = "ok";
        try {
          await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 25000 });
        } catch (e) {
          status = "navigation-failed: " + e.message.split("\n")[0];
        }
        await page.waitForTimeout(600);

        // Structural facts a screenshot alone would not make explicit.
        const facts = await page.evaluate(() => {
          const root = document.querySelector("#root");
          const text = (root?.innerText || "").trim();
          const canvases = [...document.querySelectorAll("canvas")];
          const emptyCanvases = canvases.filter((c) => c.width === 0 || c.height === 0).length;
          // Any element whose glyph font failed to load renders as a blank box.
          const brokenGlyphs = [...document.querySelectorAll("i, .fa-solid, .fas, .far")]
            .filter((el) => {
              const cs = getComputedStyle(el);
              return (cs.fontFamily || "").includes("Font Awesome") && el.textContent.trim() === "";
            }).length;
          return {
            childCount: root ? root.children.length : 0,
            textLength: text.length,
            heading: document.querySelector("h1,h2")?.innerText?.slice(0, 80) || null,
            canvases: canvases.length,
            emptyCanvases,
            brokenGlyphs,
            bodyBg: getComputedStyle(document.body).backgroundColor,
            bodyColor: getComputedStyle(document.body).color,
            hasSkipLink: !!document.querySelector("a[href='#main'], .skip-link"),
            mainCount: document.querySelectorAll("main").length,
            lang: document.documentElement.lang,
            title: document.title,
          };
        });

        if (viewport.name === "desktop") {
          await page.screenshot({
            path: `${OUT}/${label}-${scheme}.png`,
            fullPage: true,
          });
        }

        report.routes.push({ viewport: viewport.name, scheme, route, status, facts, logs, errors, failed });

        if (scheme === "light" && viewport.name === "desktop") {
          check(`renders content at ${route}`, facts.childCount > 0 && facts.textLength > 20,
            `${facts.childCount} root children, ${facts.textLength} chars`);
          check(`no page exception at ${route}`, errors.length === 0, errors.join(" | "));
          check(`no failed requests at ${route}`, failed.length === 0, failed.slice(0, 2).join(" | "));
          check(`no broken glyphs at ${route}`, facts.brokenGlyphs === 0, `${facts.brokenGlyphs} empty`);
          check(`canvas rendered at ${route}`, facts.emptyCanvases === 0,
            `${facts.canvases} canvas, ${facts.emptyCanvases} empty`);
          check(`exactly one <main> at ${route}`, facts.mainCount === 1, `${facts.mainCount}`);
        }
        await page.close();
      }
      await context.close();
    }
  }

  // ── the Fortran palette, read from the live computed styles ──────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

  const palette = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (n) => cs.getPropertyValue(n).trim();
    return {
      bg: read("--color-bg"), surface: read("--color-surface"),
      text: read("--color-text"), muted: read("--color-text-muted"),
      accent: read("--color-accent"), border: read("--color-border"),
    };
  });
  report.palette = palette;
  console.log("\n  computed palette (light):", JSON.stringify(palette, null, 2).replace(/\n/g, "\n  "));

  // Contrast, computed from the *rendered* colours rather than the token file.
  const contrast = await page.evaluate(() => {
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0322 * b;
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const bg = getComputedStyle(document.body).backgroundColor;
    const out = [];
    for (const sel of ["h1", "h2", "p", "a", "button", "small", "li", "code"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const fg = getComputedStyle(el).color;
      // Walk up for the nearest non-transparent background.
      let bgEl = el, nodeBg = "rgba(0, 0, 0, 0)";
      while (bgEl && (nodeBg === "rgba(0, 0, 0, 0)" || nodeBg === "transparent")) {
        nodeBg = getComputedStyle(bgEl).backgroundColor;
        bgEl = bgEl.parentElement;
      }
      out.push({ sel, fg, bg: nodeBg, ratio: Number(ratio(fg, nodeBg || bg).toFixed(2)) });
    }
    return out;
  });
  report.contrast = contrast;
  console.log("\n  contrast measured from rendered DOM:");
  for (const c of contrast) {
    const ok = c.ratio >= 4.5;
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${c.sel.padEnd(7)} ${String(c.ratio).padStart(6)}:1  ${c.fg} on ${c.bg}`);
  }

  fs.writeFileSync("/tmp/opencode/browser-report.json", JSON.stringify(report, null, 2));
  await page.close();
  await ctx.close();
  await browser.close();

  const failedChecks = report.checks.filter((c) => !c.pass);
  console.log(`\n${report.checks.length - failedChecks.length}/${report.checks.length} structural checks passed`);
  const withErrors = report.routes.filter((r) => r.errors.length);
  console.log(`routes with page exceptions: ${withErrors.length}`);
  for (const r of withErrors.slice(0, 6)) console.log(`   ${r.route} [${r.scheme}/${r.viewport}]: ${r.errors[0].slice(0, 140)}`);
  const withFailed = report.routes.filter((r) => r.failed.length);
  console.log(`routes with failed requests: ${withFailed.length}`);
  for (const r of withFailed.slice(0, 8)) console.log(`   ${r.route} [${r.scheme}/${r.viewport}]: ${r.failed[0].slice(0, 140)}`);
})();
