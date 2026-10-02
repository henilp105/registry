#!/usr/bin/env node
/**
 * Is this Worker actually deployable? As a gate, not a feeling.
 *
 *   node scripts/check_deploy_ready.mjs [staging|production]
 *     # default: production
 *
 * ── Why a script rather than a checklist ─────────────────────────────────────
 * `wrangler.jsonc` carries three KV namespace bindings whose ids are
 * `REPLACE_WITH_*`. That is correct and unavoidable -- a namespace id does not
 * exist until `wrangler kv namespace create` returns one -- but it means the
 * committed config **cannot be deployed as it stands**, and `wrangler deploy
 * --dry-run` will happily bind the literal placeholder:
 *
 *     env.CACHE (REPLACE_WITH_KV_NAMESPACE_ID)   KV Namespace
 *
 * So a deploy can look clean and still be wrong. This turns the deployment
 * runbook's preconditions into something a machine checks, which is the only kind
 * anyone actually runs.
 *
 * Checks:
 *   1. no `REPLACE_WITH_*` placeholder remains in the selected environment;
 *   2. the environment's origins are not localhost;
 *   3. every `env.*` the source reads is bound or is a documented secret;
 *   4. the Durable Object declares its migrations (a DO deployed without them is
 *      rejected at runtime on first use);
 *   5. `wrangler deploy --dry-run` succeeds.
 *
 * Secrets are checked for *presence in the config or the runbook*, never for
 * value -- this script must stay safe to run in CI.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = (process.argv[2] ?? "production").toLowerCase();
// `join` rather than string concatenation with a hand-stripped trailing slash: the
// first version of this file stripped the slash and then concatenated, producing
// `.../workerwrangler.jsonc` and an ENOENT before a single check ran.
const REPO = new URL("../", import.meta.url).pathname.replace(/\/+$/, "");
const WORKER = join(REPO, "worker");

let passed = 0;
const failures = [];
const ok = (n, d = "") => {
  passed++;
  console.log(`  PASS  ${n}${d ? ` — ${d}` : ""}`);
};
const bad = (n, d) => {
  failures.push({ n, d });
  console.log(`  FAIL  ${n} — ${d}`);
};
const check = (n, c, d = "") => (c ? ok(n, d) : bad(n, d || "assertion failed"));

console.log(`\ndeploy readiness — target: ${TARGET}\n`);

if (!["staging", "production"].includes(TARGET)) {
  bad("target is a known environment", `"${TARGET}" is not staging or production`);
}

// ── 1. placeholders ───────────────────────────────────────────────────────────
{
  const raw = readFileSync(join(WORKER, "wrangler.jsonc"), "utf8");

  // Isolate the block for the chosen environment, so the staging placeholder does
  // not fail a production check (and vice versa).
  let scope = raw;
  if (TARGET === "production") {
    const i = raw.indexOf('"production"');
    scope = i === -1 ? "" : raw.slice(i);
  } else {
    const start = raw.indexOf(`"${TARGET}"`);
    const rest = start === -1 ? "" : raw.slice(start);
    const prodAt = rest.indexOf('"production"');
    scope = prodAt === -1 ? rest : rest.slice(0, prodAt);
  }

  const placeholders = [...scope.matchAll(/REPLACE_WITH_[A-Z_]+/g)].map((m) => m[0]);
  check(
    `no REPLACE_WITH placeholder left in ${TARGET}`,
    placeholders.length === 0,
    placeholders.length
      ? [...new Set(placeholders)].join(", ")
      : "kv namespace ids are real",
  );

  // ── 2. origins ─────────────────────────────────────────────────────────────
  const origins = [...scope.matchAll(/"ALLOWED_ORIGINS":\s*"([^"]*)"/g)].map((m) => m[1]);
  const localish = origins.filter((o) => /localhost|127\.0\.0\.1/.test(o));
  check(
    `${TARGET} does not allow localhost origins`,
    localish.length === 0,
    localish.length ? localish.join(", ") : origins.join(", ") || "none declared",
  );

  const hosts = [...scope.matchAll(/"HOST":\s*"([^"]*)"/g)].map((m) => m[1]);
  check(
    `${TARGET} HOST is not localhost`,
    hosts.every((h) => !/localhost|127\.0\.0\.1/.test(h)),
    hosts.join(", ") || "none declared",
  );
}

// ── 3. every env.* the source reads must be bound or documented as a secret ───
{
  const runbook = ["DEPLOYMENT.md", "docs/deployment.md"]
    .map((f) => join(REPO, f))
    .filter(existsSync)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  const referenced = new Set(
    execFileSync(
      "bash",
      ["-lc", `grep -rhoE "env\\.[A-Z_]{3,}" src/ | sort -u`],
      { cwd: WORKER, encoding: "utf8" },
    )
      .split("\n")
      .map((s) => s.trim().replace(/^env\./, ""))
      .filter(Boolean),
  );

  const config = readFileSync(join(WORKER, "wrangler.jsonc"), "utf8");

  // A variable the source guards with a fallback (`env.X ?? "default"`) is
  // genuinely optional, so demanding it in the runbook would be noise. Anything
  // read without a fallback has to be bound or documented.
  const src = execFileSync("bash", ["-lc", "cat src/lib/*.ts src/db/*.ts src/routes/*.ts"], {
    cwd: WORKER,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const hasDefault = (name) => new RegExp(`env\\.${name}\\s*\\?\\?`).test(src);

  const undocumented = [...referenced].filter(
    (name) =>
      !config.includes(`"${name}"`) &&
      !runbook.includes(name) &&
      !hasDefault(name),
  );
  check(
    "every env.* the source reads is bound or named in the runbook",
    undocumented.length === 0,
    undocumented.length ? undocumented.join(", ") : `${referenced.size} references accounted for`,
  );

  // Secrets must be `wrangler secret put`, never plain `vars`.
  const inVars = [...referenced].filter(
    (n) => /(SECRET|PASSWORD|API_KEY|_KEY)$/.test(n) && new RegExp(`"${n}"\\s*:\\s*"[^"]+"`).test(config),
  );
  check(
    "no secret is set as a plain var instead of `wrangler secret put`",
    inVars.length === 0,
    inVars.length ? inVars.join(", ") : "secrets are secrets",
  );
}

// ── 4. Durable Object migrations ──────────────────────────────────────────────
{
  const raw = readFileSync(join(WORKER, "wrangler.jsonc"), "utf8");
  // `migrations` and `exports` are mutually exclusive ways to declare a Durable
  // Object, and this config uses `exports`. Checking only for `migrations` reported
  // a blocker that did not exist -- the same class of mistake as the harness that
  // asserted a field the schema had never had.
  check(
    "the Durable Object declares its lifecycle (migrations or exports)",
    /"migrations"\s*:/.test(raw) || /"exports"\s*:/.test(raw),
    /"exports"\s*:/.test(raw) ? "declared via `exports`" : "declared via `migrations`",
  );
  check("the Durable Object class is bound", /"class_name"\s*:\s*"MongoPool"/.test(raw));
  check("the tarball bucket is bound", /"TARBALLS"/.test(raw));
}

// ── 5. a real dry run ─────────────────────────────────────────────────────────
{
  let out = "";
  try {
    out = execFileSync(
      "npx",
      ["wrangler", "deploy", "--dry-run", `--env=${TARGET}`, "--outdir", "/tmp/wrangler-dryrun"],
      { cwd: WORKER, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 },
    );
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    bad("wrangler deploy --dry-run succeeds", out.trim().split("\n").slice(-3).join(" | "));
  }
  if (out) {
    const placeholderInDryRun = /REPLACE_WITH_/.test(out);
    check(
      "wrangler deploy --dry-run succeeds",
      true,
      `bundled${placeholderInDryRun ? " — WARNING: bound a REPLACE_WITH placeholder" : ""}`,
    );
    check(
      "the dry run binds no placeholder",
      !placeholderInDryRun,
      placeholderInDryRun
        ? "wrangler accepted a REPLACE_WITH id; a real deploy would bind nothing"
        : "all bindings resolved",
    );
  }
}

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log("\nNot deployable yet. Each failure below is a real blocker:\n");
  for (const f of failures) console.log(`  ${f.n}\n    ${f.d}\n`);
}
process.exit(failures.length === 0 ? 0 : 1);