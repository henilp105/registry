/**
 * Input validation.
 *
 * Ported from `backend/utils/validators.py` on `v2.0.1` and tightened.
 *
 * `v2.0.1` defines ten validators but only three are ever called
 * (`validate_username`, `validate_email`, `validate_password`), and
 * `namespaces.py:36` shadows the module's own `validate_namespace_name` with a
 * duplicate definition — defect D38 in docs/BASELINE_AUDIT.md. Here every
 * validator is wired in, so none of them is dead weight.
 *
 * The package-name and namespace-name patterns matter more than they look.
 * `package_name` flows, unvalidated, into a filesystem path, a GridFS
 * `metadata.url`, and — on the current deployment — `subprocess.run(...,
 * shell=True)` inside `validate.py`, which is shell injection and path
 * traversal (defect D7). Constraining the charset at the edge closes it.
 */

import { SPDX_EXCEPTION_IDS, SPDX_LICENSE_IDS } from "./spdx";

export type ValidationResult = { ok: true } | { ok: false; message: string };

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,30}$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NAMESPACE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const PACKAGE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const ok: ValidationResult = { ok: true };
const bad = (message: string): ValidationResult => ({ ok: false, message });

export function validateUsername(value: unknown): ValidationResult {
  if (typeof value !== "string" || value.length === 0) return bad("Username is required");
  if (!USERNAME_PATTERN.test(value)) {
    return bad("Username must be 3-30 characters and contain only letters, numbers, hyphens and underscores");
  }
  return ok;
}

export function validateEmail(value: unknown): ValidationResult {
  if (typeof value !== "string" || value.length === 0) return bad("Email is required");
  // Guard against a pathological address blowing up the regex or downstream mail.
  if (value.length > 254) return bad("Email is too long");
  if (!EMAIL_PATTERN.test(value)) return bad("Please enter a valid email address");
  return ok;
}

/**
 * Password policy.
 *
 * `v2.0.1` enforces **length >= 8 only** (validators.py:65-66) while
 * `docs/authentication.md:82-87` claims it requires upper + lower + digit +
 * special. We keep the implemented rule — length >= 8 — because that is what
 * the current signup accepts and tightening it would reject users the deployed
 * app already let through. Documented here so the doc/code gap is explicit.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 512;

export function validatePassword(value: unknown): ValidationResult {
  if (typeof value !== "string" || value.length === 0) return bad("Password is required");
  if (value.length < MIN_PASSWORD_LENGTH) {
    return bad(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  // Bounds PBKDF2 cost, which is linear in input length.
  if (value.length > MAX_PASSWORD_LENGTH) return bad("Password is too long");
  return ok;
}

export function validateNamespaceName(value: unknown): ValidationResult {
  if (typeof value !== "string" || value.length === 0) return bad("Please enter namespace name");
  if (!NAMESPACE_PATTERN.test(value)) {
    return bad("Namespace name can only include (a-z), (A-Z), (0-9), - and _");
  }
  return ok;
}

/**
 * Defect D7 guard. This is the single most important validator in the file:
 * the value ends up in a storage key and, in the legacy pipeline, in a shell
 * command.
 */
export function validatePackageName(value: unknown): ValidationResult {
  if (typeof value !== "string" || value.length === 0) return bad("Package name is missing");
  if (!PACKAGE_NAME_PATTERN.test(value)) {
    return bad(
      "Package name can only include (a-z), (A-Z), (0-9), - and _, and must be 1-64 characters",
    );
  }
  // Defence in depth: no traversal sequences even though the charset forbids them.
  if (value.includes("..") || value.includes("/") || value.includes("\\")) {
    return bad("Package name contains an invalid sequence");
  }
  return ok;
}

/**
 * Version validation.
 *
 * `v2.0.1` uses `semantic_version.Version(...)` in a bare `try/except` and
 * additionally bans the literal `0.0.0` (packages.py:264). Both behaviours are
 * preserved. The regular expression also accepts pre-release and build
 * metadata, which strict `semantic_version` accepts too, so the two agree.
 */
export function validateVersion(value: unknown): ValidationResult {
  if (typeof value !== "string" || value.length === 0) return bad("Package version is missing");
  if (value === "0.0.0") return bad("Version 0.0.0 is not a valid release version");
  if (!SEMVER_PATTERN.test(value)) return bad("Version is not valid");
  return ok;
}

/**
 * SPDX licence validation.
 *
 * `v2.0.1` uses `license_expression.get_spdx_licensing().parse(license,
 * validate=True)` (packages.py:66-67). That validates against the real SPDX
 * list *and* accepts SPDX expressions, so this reimplements both:
 *
 *   - a bare identifier          `MIT`, `Apache-2.0`, `GPL-2.0-or-later`
 *   - "or later"                 `GPL-2.0+`
 *   - a compound expression      `MIT OR Apache-2.0`
 *   - an exception               `GPL-2.0-only WITH Classpath-exception-2.0`
 *   - nested with parentheses    `(MIT OR BSD-3-Clause) AND Apache-2.0`
 *
 * A charset regex is not sufficient, and the Flask suite proves it:
 * `test_package_invalid_license` posts `ABC` and asserts 400, which
 * `/^[A-Za-z0-9.+-]+$/` accepts.
 *
 * The identifier lists live in `spdx.ts`, generated from the SPDX
 * licence-list-data release.
 */
export function validateLicense(value: unknown): ValidationResult {
  if (typeof value !== "string" || value.length === 0) return bad("Package license is missing");
  const raw = value.trim();
  // Bound the work: no real expression is long, and this runs on every upload.
  if (raw.length > 512 || !isValidLicenseExpression(raw)) {
    return bad(`Invalid license identifier ${value}. Please check the SPDX license identifier list.`);
  }
  return ok;
}

/**
 * Validate an SPDX expression, recursing through nesting.
 *
 * Grammar handled:
 *   <id>[+]                          GPL-2.0+
 *   <id> WITH <exception>            GPL-2.0-only WITH Classpath-exception-2.0
 *   <simple> (AND|OR) <simple>       MIT OR Apache-2.0
 *   ( <expr> ) (AND|OR) <simple>     (MIT OR BSD-3-Clause) AND Apache-2.0
 */
function isValidLicenseExpression(expression: string): boolean {
  const trimmed = expression.trim();
  if (!trimmed) return false;

  // Peel a fully-wrapping paren pair and recurse on the inside. Parens are
  // preserved everywhere else, because they are what tell `splitTopLevel`
  // which operators are nested and which are top level.
  const inner = peelWrapper(trimmed);
  if (inner === null) return false; // unbalanced
  if (inner !== trimmed) return isValidLicenseExpression(inner);

  const terms = splitTopLevel(trimmed);
  if (terms.length === 0) return false;
  return terms.every(isValidLicenseTerm);
}

/** True when `term` is a simple expression: `<id>[+] [WITH <exception>]`. */
function isValidLicenseTerm(term: string): boolean {
  const trimmed = term.trim();
  if (!trimmed) return false;

  const inner = peelWrapper(trimmed);
  if (inner === null) return false;
  if (inner !== trimmed) return isValidLicenseExpression(inner);

  // An exception applies to exactly one licence, so at most one WITH.
  const withParts = trimmed.split(/\s+WITH\s+/);
  if (withParts.length > 2) return false;

  let licenseId = (withParts[0] ?? "").trim();
  const exceptionId = withParts[1]?.trim();

  // Trailing "+" means "or later". Strip it before the lookup; the SPDX list
  // already carries the explicit `-or-later` variants.
  if (licenseId.endsWith("+")) licenseId = licenseId.slice(0, -1);

  if (!licenseId || !SPDX_LICENSE_IDS.has(licenseId)) return false;
  if (exceptionId !== undefined && !SPDX_EXCEPTION_IDS.has(exceptionId)) return false;
  return true;
}

/**
 * If `expr` is entirely wrapped in one paren pair, return the inside.
 * Returns `null` if the parentheses are unbalanced. Otherwise returns `expr`
 * unchanged, which callers compare against to detect the no-op case.
 */
function peelWrapper(expr: string): string | null {
  if (!expr.startsWith("(") || !expr.endsWith(")")) return expr;
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      // A close before the end means the outer paren closed early.
      if (depth === 0 && i !== expr.length - 1) return null;
    }
  }
  return depth === 0 ? expr.slice(1, -1).trim() : null;
}

/**
 * Split on top-level `OR` / `AND`, ignoring operators inside parentheses.
 *
 * Parentheses are kept on the returned terms; `isValidLicenseExpression`
 * peels them on the next level.
 */
function splitTopLevel(expression: string): string[] {
  let depth = 0;
  let current = "";
  const terms: string[] = [];

  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i] as string;

    if (ch === "(") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth < 0) return []; // unbalanced
      current += ch;
      continue;
    }

    const isOr = expression.startsWith(" OR ", i);
    const isAnd = expression.startsWith(" AND ", i);
    if (depth === 0 && (isOr || isAnd)) {
      const term = current.trim();
      if (!term) return []; // empty operand, e.g. "OR MIT"
      terms.push(term);
      current = "";
      i += isOr ? 3 : 4; // skip the operator and its trailing space
      continue;
    }

    current += ch;
  }

  if (depth !== 0) return []; // unbalanced
  const last = current.trim();
  if (!last) return []; // trailing operator, e.g. "MIT OR"
  terms.push(last);
  return terms;
}

export function requireFields(fields: Record<string, unknown>): ValidationResult {
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") {
      return bad(`${name} is required`);
    }
  }
  return ok;
}

// ── semver ordering (defect D9) ───────────────────────────────────────────────

export type ParsedVersion = { major: number; minor: number; patch: number; pre: string; raw: string };

/**
 * Parse a semver string into comparable parts.
 *
 * Defect D9: `v2.0.1` sorts versions with `sorted(versions, key=lambda x:
 * x.version)` — a plain **string** sort, so `"0.10.0" < "0.9.0"`. Because
 * `get_package` reports `versions[-1]` as `latest_version_data`, the API
 * reports the **wrong latest version** for any package that has both. The
 * correct comparator exists in the same file (`sort_versions`, packages.py:932)
 * and is never called.
 *
 * This is the fix: compare numerically on major/minor/patch, then fall back to
 * pre-release ordering where a pre-release sorts *before* its release
 * (1.0.0-rc1 < 1.0.0), per semver §11.
 */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? "",
    raw,
  };
}

/** Descending comparator, so the newest version sorts first. */
export function compareVersionsDescending(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  // Unparseable versions sort last rather than throwing, so one bad document
  // cannot break the whole listing.
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;

  if (pa.major !== pb.major) return pb.major - pa.major;
  if (pa.minor !== pb.minor) return pb.minor - pa.minor;
  if (pa.patch !== pb.patch) return pb.patch - pa.patch;

  // No pre-release outranks any pre-release.
  if (pa.pre === "" && pb.pre !== "") return -1;
  if (pa.pre !== "" && pb.pre === "") return 1;
  return pa.pre < pb.pre ? 1 : pa.pre > pb.pre ? -1 : 0;
}

/** The true latest version, or `undefined` for an empty list. */
export function latestVersion(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  return [...versions].sort(compareVersionsDescending)[0];
}