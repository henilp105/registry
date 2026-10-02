import { describe, expect, it } from "vitest";
import { jsonForbidden, jsonError } from "../src/lib/responses";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Defect D65 — a 401 that does not mean "your session is over".
 *
 * The frontend ends the session on any 401 that arrived on a request carrying an
 * `Authorization` header, on the reasoning that an anonymous caller would not
 * have sent one. That reasoning is false, because the API answers **401 to
 * authenticated callers who simply lack the permission** — it has done so since
 * `v2.0.1`, and the status is frozen by `scripts/check_api_compat.py`.
 *
 * The navbar probes `POST /users/admin` immediately after sign-in. A non-admin
 * correctly gets 401 there, the interceptor read it as an expired token, and
 * **every non-admin was logged out about a second after logging in**. Only an
 * admin could stay signed in at all.
 *
 * These tests pin the marker that tells the two apart, and — just as important —
 * pin that every permission-denied site actually emits it. The second test is the
 * one that would have caught this: the fix was applied to sixteen sites by hand,
 * and a site missed in that sweep fails the test rather than waiting to be
 * discovered by a user.
 */

const ROUTES_DIR = join(process.cwd(), "src/routes");

describe("jsonForbidden", () => {
  it("keeps the 401 status, because the contract is frozen", async () => {
    const res = jsonForbidden();
    expect(res.status).toBe(401);
    const body = await res.json<{ code: number; message: string }>();
    expect(body.code).toBe(401);
    expect(body.message).toBe("Unauthorized");
  });

  it("marks the body so a client can tell it from an expired token", async () => {
    const body = await jsonForbidden().json<{ reason?: string }>();
    expect(body.reason).toBe("forbidden");
  });

  it("accepts a custom message without losing the marker", async () => {
    const body = await jsonForbidden("Admins cannot be removed").json<{
      reason?: string;
      message: string;
    }>();
    expect(body.message).toBe("Admins cannot be removed");
    expect(body.reason).toBe("forbidden");
  });

  it("leaves a plain jsonError unmarked, so absence still means 'session over'", async () => {
    const body = await jsonError(401, "Unauthorized").json<{ reason?: string }>();
    expect(body.reason).toBeUndefined();
  });
});

describe("every permission denial is marked as forbidden", () => {
  /**
   * A `jsonError(401, "Unauthorized")` is only correct when it answers "you did
   * not authenticate". Once a user *has* been resolved, the same status with the
   * same message is ambiguous — and the ambiguity is what broke login.
   *
   * So: anywhere a `!isSiteAdmin` / `!isNamespaceAdmin` / `!canPublishPackage` /
   * `!managesOnlySelf` check is followed by a 401, that 401 must be
   * `jsonForbidden()`.
   */
  const PERMISSION_GUARDS =
    /if \(!(?:isSiteAdmin|isNamespaceAdmin|isNamespaceAuthor|isNamespaceMaintainer|canPublishPackage|managesOnlySelf|canCreatePackageIn)\b/;

  it("no permission guard answers with an unmarked 401", () => {
    const offenders: string[] = [];

    for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts"))) {
      const lines = readFileSync(join(ROUTES_DIR, file), "utf8").split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!PERMISSION_GUARDS.test(line)) continue;

        // The guard may wrap onto following lines, so look a little ahead for the
        // response it produces.
        const window = lines.slice(i, i + 4).join("\n");
        if (!window.includes("jsonError(401")) continue;
        if (window.includes("jsonForbidden")) continue;

        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 70)}`);
      }
    }

    expect(
      offenders,
      "A permission check still answers 401 without reason:'forbidden'. The client " +
        "reads that as an expired session and signs the user out (defect D65). Use " +
        "jsonForbidden() instead -- it keeps the 401 status.",
    ).toEqual([]);
  });

  it("the marker is actually reached by at least one route", () => {
    // Guards against the test above passing because the regex stopped matching,
    // which is the usual way a source-scanning test rots into a no-op.
    let found = 0;
    for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(ROUTES_DIR, file), "utf8");
      found += (src.match(/jsonForbidden\(/g) ?? []).length;
    }
    expect(found).toBeGreaterThanOrEqual(16);
  });
});