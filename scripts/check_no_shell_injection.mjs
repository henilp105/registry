#!/usr/bin/env node
/**
 * No shell-interpolated subprocess in tracked Python.
 *
 * Defect D87: `backend/validate.py` built four `subprocess.run(f"... {packagename}
 * ...", shell=True)` calls from a package name read out of the database. The
 * Worker and `scripts/validate_packages.py` are shell-free by construction, so
 * the CI security scan of the migration period never covered the one remaining
 * file that still had a shell. A publisher could choose a name and get command
 * execution on the validator host.
 *
 * The rule is deliberately narrow: `shell=True` is what makes interpolation
 * dangerous, so that is what is banned. argv lists, `cwd=`, and `shutil` are all
 * fine.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "*.py"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const SHELL = /shell\s*=\s*True/;

// Only *code* counts. A docstring that quotes `shell=True` is documentation of
// the defect; three lines of prose would otherwise fail this check, and a check
// that fails on its own explanation is a check people switch off. Python string
// literals and comments are tracked so `shlex.quote`-style "escaping" does not
// sneak past either.
const isComment = (line) => /^\s*#/.test(line);
const inString = (state, line) => {
  let inTriple = state.inTriple;
  let quote = state.quote;
  for (let i = 0; i < line.length; i += 1) {
    const three = line.slice(i, i + 3);
    if (inTriple) {
      if (three === inTriple) { inTriple = null; i += 2; }
      continue;
    }
    if (!quote && three === '"""') { inTriple = '"""'; i += 2; continue; }
    if (!quote && three === "'''") { inTriple = "'''"; i += 2; continue; }
    if (quote) {
      if (line[i] === "\\") { i += 1; continue; }
      if (line[i] === quote) quote = null;
      continue;
    }
    if (line[i] === '"' || line[i] === "'") { quote = line[i]; continue; }
  }
  return { inTriple, quote };
};

const failures = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  let state = { inTriple: null, quote: null };
  text.split("\n").forEach((line, i) => {
    const wasInString = state.inTriple !== null || state.quote !== null;
    state = inString(state, line);
    const wasComment = isComment(line);
    if (wasComment || wasInString) return;
    // Any `shell=True` in code. It is only ever a subprocess keyword argument,
    // so requiring the word "subprocess" on the same line would miss the common
    // form where the argv string and the keyword land on separate lines.
    if (SHELL.test(line)) {
      failures.push(`${file}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (failures.length > 0) {
  console.error(`shell injection — ${failures.length} finding(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    "\nUse an argument list: subprocess.run([...argv...], cwd=...). No shell means\n" +
      "no metacharacter interpretation, and nothing to escape.",
  );
  process.exit(1);
}

console.log(`PASS  no shell-interpolated subprocess in ${files.length} tracked Python files`);
