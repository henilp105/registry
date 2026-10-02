#!/usr/bin/env node
/**
 * Fails if a credential is committed to tracked source.
 *
 *   node scripts/check_no_secrets.mjs
 *
 * Run in CI. Scans tracked files only (`git ls-files`), so it never reads
 * `.dev.vars`, `node_modules` or the build output, all of which legitimately
 * contain secrets on a developer machine.
 *
 * ── Defect D71 ───────────────────────────────────────────────────────────────
 * Seven harnesses carried the production MongoDB URI — password included — as a
 * hardcoded string, in a **public** repository. For as long as those commits
 * existed, anyone who could read the repository also had read/write access to the
 * Atlas cluster: the user collection with its password hashes, every namespace,
 * every package.
 *
 * It was never necessary. The Worker reads `MONGO_URI` from `worker/.dev.vars`,
 * which is gitignored, and the harnesses run in the same shell. The value was
 * available and nobody had to embed it.
 *
 * This gate exists because the leak was invisible to everything else in the
 * pipeline: typecheck, lint, 337 tests, five CI jobs and six harnesses all passed
 * with a live credential in the tree.
 *
 * Note on remediation: removing a secret from the tree does not un-leak it. The
 * credential must be **rotated** — see `docs/BASELINE_AUDIT.md` D71.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** Files that are allowed to talk about secrets without containing any. */
const ALLOWED = new Set([
  // This file, which necessarily contains the patterns it looks for.
  "scripts/check_no_secrets.mjs",
  // Documentation and examples, where a credential-shaped string is the point.
  "DEPLOYMENT.md",
  "docs/deployment.md",
  "docs/BASELINE_AUDIT.md",
  "backend/scripts/load_db.sh",
  "backend/scripts/migrate_db.py",
  "worker/.dev.vars.example",
  // Synthetic fixtures for the legacy Flask suite that this migration replaces.
  // Listed individually rather than allowing the whole `backend/tests/` tree,
  // because "allow all of tests/" is how real credentials end up committed -- and
  // each of these is a constant that can be read and judged on its own.
  //
  // TEST_JWT_SECRET is a 28-character fixture signing the suite's own tokens;
  // TEST_PASSWORD is the account the suite registers. Neither reaches anything.
  "backend/tests/base_case.py",
  "backend/tests/test_login.py",
  "backend/tests/test_namespaces.py",
  "backend/tests/test_packages.py",
  "backend/tests/test_signup.py",
]);

const SKIP_DIRS = new Set(["node_modules", ".git", "build", "dist", "coverage", ".wrangler"]);

const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !SKIP_DIRS.has(f.split("/")[0]));

const RULES = [
  {
    name: "MongoDB URI with an inline password",
    // Requires a password that is not an obvious placeholder. `user:pass@` is a
    // doc example and must not fail the build.
    re: /mongodb(?:\+srv)?:\/\/[^:@/\s"']+:([^@/\s"']{6,})@/g,
    placeholder: /^(pass|password|user|pass:word|<[^>]+>|xxx+|\.\.\.|example|changeme|your[-_]?\w*|placeholder|\$\{[^}]+\}|%[A-Z_]+%|mongodb(\+srv)?:\/\/[^@]+@)$/i,
    secretGroup: 1,
  },
  {
    name: "GitHub personal access token",
    re: /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    secretGroup: 1,
  },
  {
    name: "Private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    secretGroup: 0,
  },
  {
    name: "OpenAI-style secret key",
    re: /\b(sk-[A-Za-z0-9]{32,})\b/g,
    secretGroup: 1,
  },
  {
    name: "Slack token",
    re: /\b(xox[abprs]-[A-Za-z0-9-]{20,})\b/g,
    secretGroup: 1,
  },
];

/**
 * A named secret assigned a literal value.
 *
 * Excludes empty values, `${VAR}` interpolation, `<...>` and `changeme`-style
 * placeholders, so `BREVO_API_KEY=` in an example file stays legal.
 */
const NAMED_SECRETS =
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY))\s*[:=]\s*["']([^"'\n]{8,})["']/gm;
const PLACEHOLDER_VALUE =
  /^(change_?me|changeme|placeholder|example|your[-_ ].*|<[^>]+>|\$\{[^}]+\}|%[A-Z_]+%|xxx+|todo|test|secret|password|another-secret-key.*|dummy|foo|bar)$/i;

const findings = [];

for (const file of files) {
  if (ALLOWED.has(file)) continue;

  let abs;
  try {
    abs = join(ROOT, file);
    if (statSync(abs).size > 2_000_000) continue; // bundles and lockfiles
  } catch {
    continue;
  }

  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  if (text.includes("�") && Buffer.byteLength(text) > 10_000_000) continue;

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const value = m[rule.secretGroup] ?? "";
      if (rule.placeholder?.test(value.trim())) continue;
      const line = text.slice(0, m.index).split("\n").length;
      findings.push({
        file,
        line,
        rule: rule.name,
        // Enough to locate it, never enough to use it.
        preview: `${value.slice(0, 3)}…${value.slice(-2)} (${value.length} chars)`,
      });
    }
  }

  NAMED_SECRETS.lastIndex = 0;
  for (const m of text.matchAll(NAMED_SECRETS)) {
    const [, name, value] = m;
    if (PLACEHOLDER_VALUE.test(value.trim())) continue;
    const line = text.slice(0, m.index).split("\n").length;
    findings.push({ file, line, rule: `${name} assigned a literal`, preview: `${value.slice(0, 3)}… (${value.length} chars)` });
  }
}

console.log(`\nsecret scan — ${files.length} tracked files\n`);

if (findings.length === 0) {
  console.log("  PASS  no credential found in tracked source");
  console.log("\n1/1 checks passed\n");
  process.exit(0);
}

console.log(`  FAIL  ${findings.length} potential credential(s) in tracked source\n`);
for (const f of findings) {
  console.log(`    ${f.file}:${f.line}  ${f.rule}`);
  console.log(`      value: ${f.preview}`);
}
console.log(`
If a finding is a false positive (a documentation example), add the path to ALLOWED
in scripts/check_no_secrets.mjs with a comment saying why.

If it is real: removing it from the tree does NOT un-leak it. Rotate the
credential first, then purge it from history. See docs/BASELINE_AUDIT.md D71.
`);
process.exit(1);