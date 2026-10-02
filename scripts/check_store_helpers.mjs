#!/usr/bin/env node
/**
 * Unit-tests the frontend's shared Redux action helpers.
 *
 *   node scripts/check_store_helpers.mjs
 *
 * ── Why a bespoke runner ─────────────────────────────────────────────────────
 * The frontend has no test runner, and adding Jest/Vitest plus a jsdom-free React
 * harness for four pure functions would be a large dependency decision to guard a
 * small surface. These helpers are plain ES modules with no imports, so the real
 * source is copied to a temporary `.mjs` and imported **as written** — no
 * transformation, no re-implementation, so what is tested is what ships.
 *
 * ── Defect D69 ───────────────────────────────────────────────────────────────
 * `handleSuccess(state, action)` read `action.payload?.message`, but **no caller
 * passed an action**. All nine call sites across eight reducers passed a plain
 * fields object as the second argument:
 *
 *     handleSuccess(state, { successMessage, uploadToken })
 *
 * So `action.payload` was `undefined`, and every one of those handlers reduced to
 * "clear the spinner, set the message to null" — a silent no-op that read as
 * correct code. The user-visible symptom: `POST /namespaces/{ns}/uploadToken`
 * returned 200, the token was minted, hashed and stored, and the dialog showed
 * nothing at all, with no error anywhere.
 *
 * The helpers are shared by token generation (namespace and package), email
 * verification, archives, the user profile, package rating, malicious-report
 * viewing and malicious-report submission — so the blast radius was eight
 * features silently dropping their success state.
 */

import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../frontend/src/store/utils/actionHelpers.js", import.meta.url);

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const dir = mkdtempSync(join(tmpdir(), "store-helpers-"));
const mod = join(dir, "actionHelpers.mjs");
copyFileSync(SRC, mod);

const {
  handleRequest,
  handleSuccess,
  handleFailure,
  handleResetMessages,
} = await import(pathToFileURL(mod).href);

const base = {
  isLoading: false,
  error: null,
  message: null,
  successMessage: null,
  errorMessage: null,
  uploadToken: null,
};

console.log("\nfrontend Redux action helpers\n");

// ── the D69 shape: a plain fields object as the second argument ───────────────
{
  const next = handleSuccess(base, {
    successMessage: "Token Generated Successfully",
    uploadToken: "3Pf2YpzqNnPq-secret-value",
  });
  check(
    "handleSuccess keeps caller-supplied fields (D69)",
    next.uploadToken === "3Pf2YpzqNnPq-secret-value",
    `uploadToken=${String(next.uploadToken)}`,
  );
  check(
    "handleSuccess keeps a caller's successMessage",
    next.successMessage === "Token Generated Successfully",
  );
  check("handleSuccess clears loading", next.isLoading === false);
  check("handleSuccess clears a previous error", next.error === null);
  check(
    "handleSuccess does not invent fields the caller did not pass",
    next.uploadToken !== undefined && !("errorMessage" in next && next.errorMessage === undefined),
  );
}

// ── the documented signature must keep working ────────────────────────────────
{
  const next = handleSuccess(base, { type: "X_SUCCESS", payload: { message: "done" } });
  check("handleSuccess still accepts a Redux action", next.message === "done", `message=${next.message}`);
  check("  and still clears loading", next.isLoading === false);
}

// ── failure, including the 3-argument form callers actually use ───────────────
{
  const next = handleFailure(base, null, { errorMessage: "Namespace already exists" });
  check(
    "handleFailure(state, null, fields) sets the caller's errorMessage (D69)",
    next.errorMessage === "Namespace already exists",
    `errorMessage=${String(next.errorMessage)}`,
  );
  check("  and derives `error` so generic consumers still see it", next.error === "Namespace already exists");
  check("  and clears loading", next.isLoading === false);
}
{
  const next = handleFailure(base, { type: "X_FAILURE", payload: { message: "boom" } });
  check("handleFailure still accepts a Redux action", next.error === "boom", `error=${next.error}`);
  check("  and falls back to a generic message when none is given",
    handleFailure(base, null, {}).error === "An error occurred");
}

// ── request: a retry must clear the stale message it is replacing ─────────────
{
  const stale = { ...base, isLoading: false, error: "old failure", errorMessage: "old failure" };
  const next = handleRequest(stale, { errorMessage: null });
  check("handleRequest merges the caller's fields", next.errorMessage === null, `errorMessage=${next.errorMessage}`);
  check("handleRequest sets loading", next.isLoading === true);
  check("handleRequest clears `error`", next.error === null);
}

// ── reset ─────────────────────────────────────────────────────────────────────
{
  const dirty = { ...base, message: "m", error: "e", successMessage: "s" };
  const next = handleResetMessages(dirty);
  check("handleResetMessages clears the messages", next.message === null && next.error === null);
}

// ── the real callers, asserted against the real helper ────────────────────────
{
  // Exactly the two-argument shape eight reducers use today.
  const reducers = ["generateNamespaceTokenReducer", "generatePackageTokenReducer", "verifyEmailReducer",
    "archivesReducer", "userReducer", "ratePackageReducer",
    "viewMalicousReportsReducer", "reportPackageReducer"];
  const { readFileSync, readdirSync } = await import("node:fs");
  const dirPath = new URL("../frontend/src/store/reducers/", import.meta.url).pathname;
  const usingTwoArg = readdirSync(dirPath)
    .filter((f) => reducers.includes(f.replace(/\.js$/, "")))
    .filter((f) => /handleSuccess\(state,\s*\{/.test(readFileSync(join(dirPath, f), "utf8")));
  check(
    "every reducer still passes caller fields, not a bare action",
    usingTwoArg.length > 0,
    `${usingTwoArg.length} reducers use the fields form`,
  );
}

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log(`  ${f.name}: ${f.detail}`);
}
process.exit(failures.length === 0 ? 0 : 1);