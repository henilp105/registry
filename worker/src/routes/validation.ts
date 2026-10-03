/**
 * Package validation — the internal API that GitHub Actions calls (Phase 8).
 *
 * ── Why this is not in the Worker ────────────────────────────────────────────
 * Validation means unpacking a tarball, running `fpm build`, parsing
 * `fpm.toml`, checking SPDX identifiers and computing per-file FNV-1a digests.
 * That is heavy CPU and, on the legacy pipeline, `subprocess.run(..., shell=True)`
 * — shell injection and path traversal straight from a package name (defect D7).
 *
 * None of it fits a 10 ms CPU budget, and Cloudflare Containers are paid. So it
 * runs in GitHub Actions, which is free on a public repository and gives each
 * job an ephemeral runner that is destroyed afterwards.
 *
 *   1. This route lists versions awaiting verification.
 *   2. The workflow downloads each tarball from R2 (free egress).
 *   3. It validates in a hardened subprocess and POSTs the verdict back.
 *   4. This route applies the verdict and retires the cached views.
 *
 * ── Authorisation ────────────────────────────────────────────────────────────
 * A dedicated bearer secret, compared in constant time. Deliberately **not** a
 * user JWT: this endpoint can mark any package as verified, so it must not be
 * reachable with a token that ordinary maintainers hold.
 */

import { db, toJsonSafe } from "../db/client";
import type { Env } from "../db/client";
import { jsonError, jsonOk } from "../lib/responses";
import { ENTITY, invalidate } from "../lib/cache";
import { logger } from "../lib/logger";
import { validateLicense } from "../lib/validators";

/** Constant-time string comparison for the shared secret. */
function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) {
    // Still compare, so the timing does not reveal the length.
    let sink = 0;
    for (let i = 0; i < expected.length; i++) sink |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    return sink === 0 && false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

type AuthOutcome = { ok: true } | { ok: false; response: Response };

function requireValidationSecret(request: Request, env: Env): AuthOutcome {
  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!env.VALIDATION_SECRET) {
    // Fail closed: an unconfigured deployment must not accept writes.
    logger.error("VALIDATION_SECRET is not set; refusing validation callbacks");
    return { ok: false, response: jsonError(503, "Validation callback is not configured") };
  }
  if (!secretMatches(presented, env.VALIDATION_SECRET)) {
    return { ok: false, response: jsonError(401, "Unauthorized") };
  }
  return { ok: true };
}

/** Bounded so one run cannot be handed the entire backlog. */
const MAX_BATCH = 50;

export async function handleValidationRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: import("../lib/auth").AuthContext | null,
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  // GET /internal/validation/pending?limit=N
  if (method === "GET" && segments.length === 3 && segments[2] === "pending") {
    const gate = requireValidationSecret(request, env);
    if (!gate.ok) return gate.response;
    return pendingWork(env, url);
  }

  // POST /internal/validation/result
  if (method === "POST" && segments.length === 3 && segments[2] === "result") {
    const gate = requireValidationSecret(request, env);
    if (!gate.ok) return gate.response;
    return applyResult(request, env);
  }

  void ctx;
  void auth;
  return null;
}

/**
 * List versions awaiting verification.
 *
 * `unable_to_verify` is the marker. It is set at upload and cleared on a
 * successful validation. A FAILED verdict also stamps `validation_error`, and
 * the queue below excludes any version carrying one — otherwise a failed
 * package would be re-queued forever and the runner would re-POST the same
 * failure in a loop (defect: validation retries with no new input).
 */
async function pendingWork(env: Env, url: URL): Promise<Response> {
  const requested = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_BATCH) : 10;

  const docs = (await db<Record<string, unknown>[]>(env, {
    kind: "aggregate",
    collection: "packages",
    pipeline: [
      { $match: { unable_to_verify: true, is_deprecated: false } },
      { $sort: { updated_at: 1 } },
      { $limit: limit },
      {
        $project: {
          name: 1,
          namespace: 1,
          namespace_name: 1,
          license: 1,
          updated_at: 1,
          versions: {
            $filter: {
              input: { $ifNull: ["$versions", []] },
              as: "v",
              cond: {
                $and: [
                  { $ne: ["$$v.unable_to_verify", false] },
                  { $eq: [{ $ifNull: ["$$v.validation_error", null] }, null] },
                ],
              },
            },
          },
        },
      },
    ],
  })) as Record<string, unknown>[];

  const jobs = [];
  for (const doc of docs) {
    const namespaceName = String(doc.namespace_name ?? "");
    for (const version of (doc.versions ?? []) as Record<string, unknown>[]) {
      if (version.unable_to_verify === false) continue;
      // A version that already failed validation stays visible but must not be
      // re-offered: nothing about the artifact changed since the verdict.
      if (version.validation_error != null) continue;
      const versionName = String(version.version ?? "");
      jobs.push({
        namespace: namespaceName,
        package: String(doc.name ?? ""),
        version: versionName,
        license: doc.license ?? null,
        // The absolute download URL, so the runner needs no extra config.
        tarball_url: `${env.HOST}/tarballs/${namespaceName}/${doc.name}/${versionName}`,
        declared_sha256: version.sha256 ?? null,
        size: version.size ?? null,
        submitted_at: toJsonSafe(doc.updated_at),
      });
    }
  }

  return jsonOk({
    message: "Pending validation jobs",
    jobs,
    count: jobs.length,
    hint: "Validate each job, then POST the outcome to /internal/validation/result",
  });
}

export type ValidationVerdict = {
  namespace: string;
  package: string;
  version: string;
  ok: boolean;
  /** Machine-readable reason, e.g. "license_invalid", "fpm_toml_missing". */
  reason?: string;
  message?: string;
  description?: string;
  registry_description?: string;
  homepage?: string;
  repository?: string;
  copyright?: string;
  license?: string;
  /** Per-file FNV-1a digests, as `fpm` records them. */
  digests?: Record<string, string>;
};

/**
 * Apply a verdict.
 *
 * A success writes the metadata `validate.py` used to extract from the tarball,
 * plus per-file digests. A failure records the reason and leaves
 * `unable_to_verify` set, so the item stays visible instead of being silently
 * dropped.
 */
async function applyResult(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, "Expected a JSON body");
  }

  const results = Array.isArray(payload)
    ? (payload as ValidationVerdict[])
    : [payload as ValidationVerdict];

  if (results.length === 0) return jsonError(400, "No results supplied");
  if (results.length > MAX_BATCH) {
    return jsonError(400, `At most ${MAX_BATCH} results per request`);
  }

  let applied = 0;
  let failed = 0;

  for (const result of results) {
    const namespaceName = result?.namespace;
    const packageName = result?.package;
    const versionName = result?.version;

    if (!namespaceName || !packageName || !versionName) {
      failed += 1;
      continue;
    }
    // Re-validate every field the runner echoes back. The runner is trusted, but
    // a compromised or misconfigured one must not be able to write arbitrary
    // keys into a package document.
    if (!validatePackageFields(result)) {
      logger.warn("rejected malformed validation result", { namespaceName, packageName, versionName });
      failed += 1;
      continue;
    }

    if (result.license !== undefined) {
      const licenseCheck = validateLicense(result.license);
      if (!licenseCheck.ok) {
        logger.warn("validation reported an invalid SPDX identifier", { license: result.license });
        failed += 1;
        continue;
      }
    }

    const versionSet: Record<string, unknown> = {
      is_verified: result.ok,
      unable_to_verify: !result.ok,
      verified_at: new Date(),
    };
    if (result.ok) {
      versionSet.validation_error = null;
    } else {
      versionSet.validation_error = result.reason ?? "validation_failed";
      versionSet.validation_message = (result.message ?? "").slice(0, 500);
    }

    // Package metadata refreshes from each successful result; the version
    // element update itself is positional via arrayFilters (see below).
    let doc = (await db<Record<string, unknown> | null>(env, {
      kind: "findOne",
      collection: "packages",
      filter: { name: packageName, namespace_name: namespaceName },
      projection: { versions: 1, _id: 1 },
    })) as Record<string, unknown> | null;

    if (!doc) {
      // Legacy package documents predate the denormalised `namespace_name`
      // field and can only be located by resolving the namespace ObjectId,
      // the same fallback the read/delete paths use. Without this their
      // verdicts 404'd forever and the package stayed pending.
      const namespace = (await db<{ _id?: unknown } | null>(env, {
        kind: "findOne",
        collection: "namespaces",
        filter: { namespace: namespaceName },
        projection: { _id: 1 },
      })) as { _id?: unknown } | null;
      if (namespace && namespace._id !== undefined) {
        doc = (await db<Record<string, unknown> | null>(env, {
          kind: "findOne",
          collection: "packages",
          filter: { name: packageName, namespace: namespace._id },
          projection: { versions: 1, _id: 1 },
        })) as Record<string, unknown> | null;
      }
    }

    if (!doc) {
      failed += 1;
      continue;
    }

    const packageSet: Record<string, unknown> = { updated_at: new Date() };
    if (result.ok) {
      // Metadata comes from fpm.toml and the README, extracted by the runner.
      if (result.description !== undefined) packageSet.description = result.description;
      if (result.registry_description !== undefined) {
        packageSet.registry_description = result.registry_description;
      }
      if (result.homepage !== undefined) packageSet.homepage = result.homepage;
      if (result.repository !== undefined) packageSet.repository = result.repository;
      if (result.copyright !== undefined) packageSet.copyright = result.copyright;
      if (result.license !== undefined) packageSet.license = result.license;
      packageSet.is_verified = true;
      packageSet.unable_to_verify = false;
      packageSet.security_status = "No security issues found";
    }

    // arrayFilters touch only the matching version element: the previous
    // whole-array rewrite lost any concurrent verdict or publish that landed
    // between the findOne and the updateOne.
    const versionSetFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(versionSet)) versionSetFields[`versions.$[v].${k}`] = v;

    await db(env, {
      kind: "updateOne",
      collection: "packages",
      filter: { _id: doc._id, "versions.version": versionName },
      update: { $set: { ...versionSetFields, ...packageSet } },
      arrayFilters: [{ "v.version": versionName }],
    });

    await invalidate(
      env,
      ENTITY.package(namespaceName, packageName),
      ENTITY.namespacePackages(namespaceName),
    );

    applied += 1;
    if (result.ok) logger.info("package verified", { namespaceName, packageName, versionName });
    else logger.warn("package failed validation", { namespaceName, packageName, versionName, reason: result.reason });
  }

  return jsonOk({ message: "Validation results applied", applied, failed });
}

/**
 * Reject any field the runner has no business setting.
 *
 * An allow-list, because the runner's output is written into a package document
 * that the public API serves.
 */
function validatePackageFields(result: ValidationVerdict): boolean {
  const ALLOWED = new Set([
    "namespace",
    "package",
    "version",
    "ok",
    "reason",
    "message",
    "description",
    "registry_description",
    "homepage",
    "repository",
    "copyright",
    "license",
    "digests",
  ]);

  for (const key of Object.keys(result)) {
    if (!ALLOWED.has(key)) return false;
  }

  if (typeof result.ok !== "boolean") return false;
  if (typeof result.namespace !== "string" || typeof result.package !== "string") return false;
  if (typeof result.version !== "string") return false;

  // Bound every free-text field: `registry_description` is an entire README.
  const TEXT_LIMIT = 64 * 1024;
  for (const field of ["description", "registry_description", "homepage", "repository", "copyright", "message"] as const) {
    const value = result[field];
    if (value !== undefined && (typeof value !== "string" || value.length > TEXT_LIMIT)) return false;
  }

  if (result.digests !== undefined) {
    if (typeof result.digests !== "object" || result.digests === null) return false;
    const entries = Object.entries(result.digests);
    if (entries.length > 20_000) return false;
    for (const [path, digest] of entries) {
      if (typeof digest !== "string" || digest.length > 64) return false;
      // fpm digests are keyed by path; refuse anything that could escape a
      // working directory if a future validator writes them to disk.
      if (path.includes("..") || path.startsWith("/")) return false;
    }
  }

  return true;
}

export { secretMatches, MAX_BATCH };