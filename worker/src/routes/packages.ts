/**
 * Packages — read paths (Phase 5) and the upload path (Phase 6).
 *
 * ── Routing hazards ──────────────────────────────────────────────────────────
 * `/packages` is three different things depending on method and path depth:
 *   GET  /packages                       search
 *   POST /packages                       upload
 *   PUT  /packages                       deprecate   (did not exist on v2.0.1)
 *   GET  /packages/{ns}/{pkg}            one package
 *   GET  /packages/{ns}/{pkg}/{version}  one version
 * Method is checked first, because `GET /packages?query=` and
 * `GET /packages/{ns}/{pkg}` share a prefix.
 *
 * ── Defects closed here ──────────────────────────────────────────────────────
 * D9   `latest_version_data` was wrong for any package with both 0.9.0 and
 *      0.10.0, because `v2.0.1` sorts `versions[]` with a plain string sort and
 *      reports `versions[-1]`. Fixed with a numeric comparator, which the test
 *      suite pins by asserting our answer differs from the legacy one.
 * D18  Search used unescaped `$regex` over `registry_description`, which holds
 *      the entire README.md — an unindexed full scan *and* a ReDoS vector.
 *      Now it uses the weighted `$text` index that Phase 2 created and
 *      `v2.0.1` created but never queried.
 * D19  `limit` could be raised to the whole collection size, materialising every
 *      package in-request. Now hard-capped.
 * D21  `ratings` was returned as `[3.0]` — a 1-tuple from `round()`, serialised
 *      as a JSON array. Now a number.
 * D24  No artifact checksum was ever stored. Phase 6 adds SHA-256.
 * D26  Deprecating was unreachable: `PUT /packages` did not exist, so the
 *      frontend got a 405, and nothing could be un-deprecated either.
 * D34  `verify_user_role` queried `{"namespace": namespace_name}` against a field
 *      that holds an ObjectId, so it always 404'd. Fixed.
 */

import { db, toJsonSafe } from "../db/client";
import type { Env } from "../db/client";
import {
  jsonError,
  jsonForbidden,
  jsonOk,
} from "../lib/responses";
import type { AuthContext } from "../lib/auth";
import { canPublishPackage, isSiteAdmin, strId } from "../lib/permissions";
import { isDuplicateKeyError, versionAppendFilter } from "../lib/publish";
import {
  compareVersionsDescending,
  validateLicense,
  validatePackageName,
  validateVersion,
} from "../lib/validators";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SKIP,
  SORT_MAP,
  buildMatchFilter,
  clampInt,
  escapeRegex,
  planSearch,
  sortDirection,
} from "../lib/search";
import { consumeUploadToken, tokenAllows } from "../lib/upload-tokens";
import {
  MAX_TARBALL_BYTES,
  TarballTooLarge,
  deletePackageTarballs,
  deleteTarball,
  hashTarball,
  putTarballBytes,
  tarballKey,
  type StoredTarball,
} from "../lib/storage";
import { toHexOrId } from "../lib/ids";
import { ENTITY, TTL, entityVersion, invalidate, serveCached } from "../lib/cache";
import { readBody, findUser, resolvePackageTarget } from "./namespaces-shared";
import { logger } from "../lib/logger";

export async function handlePackageRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: AuthContext | null,
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const [, a, b, c, d] = segments;

  // GET /packages?query=… — search
  if (method === "GET" && segments.length === 1) return searchPackages(env, url);

  // POST /packages — upload
  if (method === "POST" && segments.length === 1) return upload(request, env, ctx);

  // PUT /packages — deprecate / un-deprecate. New in this migration.
  if (method === "PUT" && segments.length === 1) return deprecatePackage(request, env, auth);

  // POST /packages/{ns}/{pkg}/verify — role probe (fixed D34)
  if (method === "POST" && segments.length === 4 && c === "verify") {
    return verifyUserRole(env, auth, a as string, b as string);
  }

  // POST /packages/{ns}/{pkg}/delete
  if (method === "POST" && segments.length === 4 && c === "delete") {
    return deletePackage(env, auth, a as string, b as string, ctx);
  }

  // POST /packages/{ns}/{pkg}/{version}/delete
  if (method === "POST" && segments.length === 5 && d === "delete") {
    return deleteVersion(env, auth, a as string, b as string, c as string, ctx);
  }

  // POST /packages/{ns}/{pkg}/uploadToken
  if (method === "POST" && segments.length === 4 && c === "uploadToken") {
    return createPackageUploadToken(env, auth, a as string, b as string);
  }

  // GET or POST /packages/{ns}/{pkg}/maintainers — a read over either verb.
  if ((method === "GET" || method === "POST") && segments.length === 4 && c === "maintainers") {
    return packageMaintainers(request, env, a as string, b as string);
  }

  // GET /packages/{ns}/{pkg}/{version}
  if (method === "GET" && segments.length === 4) {
    return getVersion(request, env, a as string, b as string, c as string);
  }

  // GET /packages/{ns}/{pkg}
  if (method === "GET" && segments.length === 3) return getPackage(request, env, a as string, b as string);

  return null;
}

// ── GET /packages?query=&page=&sorted_by= ────────────────────────────────────

/**
 * Search.
 *
 * Contract (docs/API_CONTRACT.md §2.3): `page` is **0-based**,
 * `sorted_by` is one of `"" | "name" | "updatedat" | "createdat" | "downloads"`,
 * and the response is `{packages[], total_pages}` with no `code` check on the
 * client side.
 *
 * Defect D18: `v0.0.1` ran an unanchored, case-sensitive `$regex` over `name`
 * and `description` plus two `$in` matches, then a second full collection scan
 * for `count_documents` — with the user's raw query interpolated straight into
 * the pattern. Now one `$text` query against the weighted index that Phase 2
 * built, with the query length capped.
 */
async function searchPackages(env: Env, url: URL): Promise<Response> {
  const rawQuery = (url.searchParams.get("query") ?? "fortran").trim();
  const page = clampInt(url.searchParams.get("page"), 0, 0, MAX_SKIP);
  const sortedBy = (url.searchParams.get("sorted_by") ?? "").toLowerCase();
  const limit = clampInt(url.searchParams.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  // Defect D77: MAX_SKIP used to clamp the *page number*, so the actual skip
  // could reach 10_000 * 50 = 500_000 -- a collection scan behind every request.
  const skip = Math.min(page * limit, MAX_SKIP);

  // Public sort names map onto the fields that actually exist on the document.
  // v2.0.1 accepted `updatedat` but the field is `updated_at`, and accepted
  // `downloads` when there was no such field at all, so both silently fell back
  // to sorting by name.
  const sortField = SORT_MAP[sortedBy] ?? "name";

  // Shaping happens in a final $project stage rather than in the initial
  // projection, so the sort still sees `updated_at` / `download_count` while the
  // response only carries the five documented fields.
  const direction = sortDirection(url.searchParams.get("sort"));

  // A pathological or injection-shaped query must not reach the matcher.
  const plan = planSearch(rawQuery);
  const filter = buildMatchFilter(plan, { is_deprecated: false });
  const usesText = plan.kind === "text";

  // Shaping happens in a final $project stage rather than in the initial
  // projection, so the sort still sees `updated_at` / `download_count` while the
  // response only carries the five documented fields.
  // `$text` results are ordered by relevance; everything else by the mapped
  // field. Only one of these two applies, so build the sort object explicitly
  // rather than with a computed key.
  // Defect D81: non-unique sort keys (name, textScore) made pagination
  // non-deterministic -- two queries for consecutive pages could order ties
  // differently and yield duplicate or skipped rows. Every sort is broken by
  // a unique key as the last comparator.
  const sort: Record<string, unknown> = usesText
    ? { score: { $meta: "textScore" }, name: 1, _id: 1 }
    : { [sortField]: direction, name: 1, _id: 1 };

  const pipeline: Record<string, unknown>[] = [{ $match: filter }, { $sort: sort }];

  pipeline.push({ $skip: skip }, { $limit: limit });
  // The legacy response concatenated `keywords + categories` into one array.
  pipeline.push({
    $project: {
      name: 1,
      namespace_name: 1,
      description: 1,
      keywords: { $concatArrays: [{ $ifNull: ["$keywords", []] }, { $ifNull: ["$categories", []] }] },
      updated_at: 1,
    },
  });

  const [rows, total] = await Promise.all([
    db<unknown[]>(env, { kind: "aggregate", collection: "packages", pipeline }),
    db<number>(env, {
      kind: "count",
      collection: "packages",
      // Defect D85: for `$text` plans this recounted with the query's
      // `$text` clause dropped, so `total_pages` reflected the whole
      // registry rather than the search result.
      filter,
    }),
  ]);

  const totalDocs = total ?? 0;
  // Zero results means zero pages. The legacy behaviour of reporting one page for
  // an empty result is not reproduced.
  const totalPages = totalDocs > 0 && limit > 0 ? Math.ceil(totalDocs / limit) : 0;

  return jsonOk({
    packages: ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
      name: r.name,
      namespace: r.namespace_name,
      description: r.description,
      keywords: r.keywords ?? [],
      updated_at: toJsonSafe(r.updated_at),
    })),
    total_pages: totalPages,
  });
}


/**
 * Dispatcher for `GET /packages_cli`.
 *
 * Separate from `handlePackageRoutes` because the router matches on the first
 * path segment: `/packages_cli` never enters the `packages` branch, so putting
 * this check inside that handler would have been dead code. It was, briefly.
 */
export async function handlePackageCliRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: AuthContext | null,
): Promise<Response | null> {
  void ctx;
  void auth;
  if (request.method.toUpperCase() === "GET" && segments.length === 1) {
    return searchPackagesCli(env, url);
  }
  return null;
}

// ── GET /packages_cli ───────────────────────────────────────────────────────

/**
 * Search, shaped for the `fpm` CLI.
 *
 * ── Why this route is separate from `/packages` ────────────────────────────
 * It is not a stylistic choice. The two endpoints disagree on the wire in ways a
 * client can observe, and `v0.0.1` preserved both:
 *
 *   - `page` is **1-based** here and 0-based on `/packages`. The CLI subtracts
 *     one before computing `skip`; the web frontend does not.
 *   - `*` is a sentinel meaning "any" for `namespace`, `package` and `license`.
 *   - an empty result is a **404** here with `{"status":"error", ...}`, while
 *     `/packages` returns 200 and an empty array. The CLI reads the 404 as
 *     "nothing found"; the web UI renders an empty state.
 *   - each entry carries a flattened `version` string rather than a nested
 *     `latest_version_data` object.
 *
 * Making this a copy of `/packages` would have silently broken every one of them.
 *
 * ── Defect D48: documented but never implemented ─────────────────────────────
 * Phase 9 generated the OpenAPI document from the route table and listed
 * `/packages_cli`, recovered from `packages.py`'s `@swag_from`. No handler was
 * ever written, so the route was published in the API spec and answered 404.
 * Documenting a route that does not exist is worse than omitting it: a client
 * generator emits a method for it, and a reader trusts the spec.
 *
 * Found by walking the *generated* spec and requesting every route it documents.
 * `openapi.test.ts` asserted only that every spec entry appears in the document,
 * never that every documented route is actually routed, so it passed.
 *
 * Defect D18 applies here as on `/packages`: `v0.0.1` interpolated the user's
 * query straight into an unescaped `$regex` and then ran a second full scan for
 * `count_documents`. Now one `$text` query against the weighted index, and the
 * filters are escaped matches over bounded inputs.
 */
async function searchPackagesCli(env: Env, url: URL): Promise<Response> {
  const rawQuery = (url.searchParams.get("query") ?? "fortran").trim();
  // 1-based, converted once here so the rest of the function is 0-based like
  // every other page calculation in this codebase.
  const page = clampInt(url.searchParams.get("page"), 1, 1, MAX_SKIP) - 1;
  const limit = clampInt(url.searchParams.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  // See searchPackages: MAX_SKIP bounds the skip, not the page number.
  const skip = Math.min(page * limit, MAX_SKIP);
  const sortedBy = (url.searchParams.get("sorted_by") ?? "name").toLowerCase();
  const sortField = SORT_MAP[sortedBy] ?? "name";
  const direction = sortDirection(url.searchParams.get("sort"));

  // `*` is the CLI's "any" sentinel, not a literal to match against.
  const wildcard = (key: string): string | null => {
    const value = url.searchParams.get(key);
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === "" || trimmed === "*" ? null : trimmed;
  };
  const namespace = wildcard("namespace");
  const packageName = wildcard("package");
  const license = wildcard("license");

  const extra: Record<string, unknown> = {};
  if (namespace) extra.namespace_name = { $regex: `^${escapeRegex(namespace)}`, $options: "i" };
  if (packageName) extra.name = { $regex: `^${escapeRegex(packageName)}`, $options: "i" };
  if (license) extra.license = { $regex: escapeRegex(license), $options: "i" };

  const plan = planSearch(rawQuery);
  const filter = buildMatchFilter(plan, { is_deprecated: false, ...extra });

  const [rows, total] = await Promise.all([
    db<Record<string, unknown>[]>(env, {
      kind: "aggregate",
      collection: "packages",
      pipeline: [
        { $match: filter },
        { $sort: plan.kind === "text" ? { score: { $meta: "textScore" } } : { [sortField]: direction } },
        { $skip: skip },
        { $limit: limit },
        { $project: { name: 1, namespace_name: 1, description: 1, versions: 1 } },
      ],
    }),
    db<number>(env, {
      kind: "count",
      collection: "packages",
      // Defect D85: same `$text`-drop bug in the CLI route — count must use
      // the pipeline's own filter.
      filter,
    }),
  ]);

  const packages = (rows ?? []).map((row) => ({
    name: row.name,
    namespace: row.namespace_name,
    description: row.description,
    // Newest by semver, not `versions[-1]`. v0.0.1 took the last element of a
    // string-sorted list, so a package holding both 0.9.0 and 0.10.0 advertised
    // 0.9.0 as its latest: the same defect as D9.
    version: latestVersionOf(row.versions),
  }));

  // 404 on empty is this route's legacy contract specifically. Changing it would
  // make `fpm search` read "no matches" as a transport failure.
  if (packages.length === 0) {
    return jsonError(404, "packages not found", { status: "error" });
  }

  const totalDocs = total ?? 0;
  return jsonOk({ packages, total_pages: limit > 0 ? Math.ceil(totalDocs / limit) : 0 });
}

/** Newest version by semver comparison, or `null` when there are none. */
function latestVersionOf(versions: unknown): string | null {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const entries = versions
    .map((v) => (v as { version?: unknown })?.version)
    .filter((v): v is string => typeof v === "string");
  if (entries.length === 0) return null;
  return [...entries].sort(compareVersionsDescending)[0] ?? null;
}

// ── GET /packages/{ns}/{pkg} ─────────────────────────────────────────────────

async function getPackage(request: Request, env: Env, namespaceName: string, packageName: string): Promise<Response> {
  const entity = ENTITY.package(namespaceName, packageName);
  const version = await entityVersion(env, entity);

  return serveCached(
    request,
    new URL(`https://internal/pkg/${namespaceName}/${packageName}`),
    TTL.package,
    version,
    async () => {
      const target = await resolvePackageTarget(env, namespaceName, packageName);
      if (!target.ok) return target.response;

      const pkg = target.package;
      const versions = (pkg.versions ?? []) as Record<string, unknown>[];

      // ── Defect D9 ──────────────────────────────────────────────────────────
      // v2.0.1: `latest_version_data = versions[-1]` where `versions` came from
      // `sorted(versions, key=lambda x: x.version)`. A string sort puts
      // "0.10.0" before "0.9.0", so the advertised latest version was wrong.
      const sorted = [...versions].sort((x, y) =>
        compareVersionsDescending(String(x.version ?? ""), String(y.version ?? "")),
      );

      // Contract: the frontend reads latest_version_data.version and
      // version_history[].{version, created_at, download_url, isDeprecated}.
      // Note it reads `isDeprecated` (camelCase) while v2.0.1 emits
      // `is_deprecated` (snake_case, boolean), so every version rendered as
      // "Active". Both keys are emitted — additive only.
      const shape = (v: Record<string, unknown>) => ({
        version: v.version,
        tarball: v.tarball,
        dependencies: v.dependencies,
        created_at: toJsonSafe(v.created_at),
        download_url: v.download_url,
        is_deprecated: Boolean(v.is_deprecated),
        isDeprecated: v.is_deprecated ? "true" : "false",
        is_verified: Boolean(v.is_verified),
        oid: v.oid ? strId(v.oid) : undefined,
      });

      return jsonOk({
        data: {
          name: pkg.name,
          namespace: pkg.namespace_name,
          description: pkg.description,
          registry_description: pkg.registry_description,
          homepage: pkg.homepage,
          repository: pkg.repository,
          copyright: pkg.copyright,
          license: pkg.license,
          author: target.authorUsername,
          keywords: pkg.keywords ?? [],
          categories: pkg.categories ?? [],
          created_at: toJsonSafe(pkg.created_at),
          updated_at: toJsonSafe(pkg.updated_at),
          is_verified: Boolean(pkg.is_verified),
          is_malicious: Boolean(pkg.is_malicious),
          security_status: pkg.security_status ?? "No security issues found",
          unable_to_verify: Boolean(pkg.unable_to_verify),
          maintainers: pkg.maintainers ?? [],
          // Newest first, numerically ordered.
          latest_version_data: sorted[0] ? shape(sorted[0]) : null,
          version_history: sorted.map(shape),
          // Defect D21: v2.0.1 returned `round(sum/len, 3)`, a 1-tuple, which
          // Flask serialised as the JSON array [3.0].
          ratings: averageRating(pkg.ratings),
          ratings_count: ratingCounts(pkg.ratings),
          downloads: pkg.download_count ?? 0,
        },
      });
    },
  );
}

/** Defect D21: return a number, not a one-element array. */
function averageRating(ratings: unknown): number | null {
  const counts = ratingCounts(ratings) as Record<string, number>;
  const buckets = Object.entries(counts);
  const totalVotes = buckets.reduce((n, [, c]) => n + c, 0);
  if (totalVotes === 0) return null;
  const sum = buckets.reduce((n, [star, c]) => n + Number(star) * c, 0);
  return Math.round((sum / totalVotes) * 1000) / 1000;
}

function ratingCounts(ratings: unknown): Record<string, number> {
  const source = (ratings ?? {}) as { counts?: Record<string, number> };
  const counts = source.counts ?? {};
  // Always emit all five buckets so the client never has to guard for a missing key.
  const out: Record<string, number> = {};
  for (const star of ["1", "2", "3", "4", "5"]) out[star] = Number(counts[star] ?? 0);
  return out;
}

// ── GET /packages/{ns}/{pkg}/{version} ───────────────────────────────────────

async function getVersion(request: Request, env: Env, namespaceName: string, packageName: string, wanted: string): Promise<Response> {
  const entity = ENTITY.package(namespaceName, packageName);
  const version = await entityVersion(env, entity);

  const internal = new URL(`https://internal/pkg/${namespaceName}/${packageName}/${wanted}`);
  return serveCached(
    request,
    internal,
    TTL.version,
    version,
    async () => {
      const target = await resolvePackageTarget(env, namespaceName, packageName);
      if (!target.ok) return target.response;

      const versions = (target.package.versions ?? []) as Record<string, unknown>[];
      // Numeric equality, not a prefix or loose compare: `0.1` must not match `0.10.0`.
      const found = versions.find((v) => String(v.version) === wanted);
      if (!found) return jsonError(404, "Package version not found");

      return jsonOk({
        data: {
          name: target.package.name,
          namespace: target.package.namespace_name,
          author: target.authorUsername,
          keywords: target.package.keywords ?? [],
          categories: target.package.categories ?? [],
          license: target.package.license,
          description: target.package.description,
          created_at: toJsonSafe(target.package.created_at),
          updatedAt: toJsonSafe(target.package.updated_at),
          version_data: {
            version: found.version,
            tarball: found.tarball,
            dependencies: found.dependencies,
            created_at: toJsonSafe(found.created_at),
            download_url: found.download_url,
            is_deprecated: Boolean(found.is_deprecated),
            isDeprecated: found.is_deprecated ? "true" : "false",
            oid: found.oid ? strId(found.oid) : undefined,
          },
        },
      });
    },
  );
}

// ── GET|POST /packages/{ns}/{pkg}/maintainers ────────────────────────────────

async function packageMaintainers(request: Request, env: Env, namespaceName: string, packageName: string): Promise<Response> {
  const entity = ENTITY.package(namespaceName, packageName);
  const version = await entityVersion(env, entity);
  const internal = new URL(`https://internal/pkg/${namespaceName}/${packageName}/maintainers`);

  return serveCached(
    request,
    internal,
    TTL.members,
    version,
    async () => {
      const target = await resolvePackageTarget(env, namespaceName, packageName);
      if (!target.ok) return target.response;

      const users = (await db<unknown[]>(env, {
        kind: "find",
        collection: "users",
        filter: { _id: { $in: (target.package.maintainers ?? []) as unknown[] } },
        projection: { username: 1 },
      })) as Record<string, unknown>[];

      return jsonOk({
        users: (users ?? []).map((u) => ({ id: strId(u._id), username: u.username })),
      });
    },
  );
}

// ── POST /packages/{ns}/{pkg}/verify ──────────────────────────────────────────

/**
 * Role probe: "may the current user publish here?"
 *
 * Defect D34: v2.0.1 queried `{"name": pkg, "namespace": namespace_name}`,
 * comparing the namespace *name* against a field that holds an ObjectId. It
 * therefore always returned 404 and the frontend's role-gated UI never
 * appeared. `resolvePackageTarget` does the lookup correctly, once.
 */
async function verifyUserRole(
  env: Env,
  auth: AuthContext | null,
  namespaceName: string,
  packageName: string,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const actor = await findUser(env, auth.uuid);
  if (!actor) return jsonError(404, "User not found");

  const target = await resolvePackageTarget(env, namespaceName, packageName);
  if (!target.ok) return target.response;

  const allowed = canPublishPackage(actor, target.namespace, target.package);
  // The frontend stores `result.data.isVerified` directly and the contract
  // expects a boolean here.
  return jsonOk({ status: allowed ? "success" : "error", isVerified: allowed });
}

// ── POST /packages/{ns}/{pkg}/{version}/delete ────────────────────────────────

async function deleteVersion(
  env: Env,
  auth: AuthContext | null,
  namespaceName: string,
  packageName: string,
  version: string,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");
  const actor = await findUser(env, auth.uuid);
  if (!actor) return jsonError(404, "User not found");
  if (!isSiteAdmin(actor)) return jsonForbidden();

  const target = await resolvePackageTarget(env, namespaceName, packageName);
  if (!target.ok) return target.response;

  const versions = (target.package.versions ?? []) as Record<string, unknown>[];
  // v2.0.1 never checked the version existed and returned success for any
  // string. Check first so a typo does not report a deletion that did not happen.
  const removed = versions.find((v) => String(v.version) === version);
  if (!removed) return jsonError(404, "Package version not found");

  await db(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: target.package._id },
    update: { $pull: { versions: { version } }, $set: { updated_at: new Date() } },
  });

  // A package left with no versions is no longer installable, so remove it.
  const remaining = versions.filter((v) => String(v.version) !== version);
  if (remaining.length === 0) {
    await db(env, { kind: "deleteOne", collection: "packages", filter: { _id: target.package._id } });
    await db(env, {
      kind: "updateOne",
      collection: "namespaces",
      filter: { _id: target.namespace._id },
      update: { $pull: { packages: target.package._id } },
    });
    await db(env, {
      kind: "updateMany",
      collection: "users",
      filter: {},
      update: { $pull: { authorOf: target.package._id, maintainerOf: target.package._id } },
    });
  }

  // D78: the R2 object used to be left behind. The key is derivable from the
  // same three segments that just identified the version document.
  ctx.waitUntil(deleteTarball(env, tarballKey(namespaceName, packageName, version)));

  await invalidate(env, ENTITY.package(namespaceName, packageName), ENTITY.namespacePackages(namespaceName));
  ctx.waitUntil(Promise.resolve(logger.info("version deleted", { namespaceName, packageName, version })));

  return jsonOk({ message: "Package version deleted successfully" });
}

// ── POST /packages/{ns}/{pkg}/delete ─────────────────────────────────────────

async function deletePackage(
  env: Env,
  auth: AuthContext | null,
  namespaceName: string,
  packageName: string,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");
  const actor = await findUser(env, auth.uuid);
  if (!actor) return jsonError(404, "User not found");
  if (!isSiteAdmin(actor)) return jsonForbidden();

  const target = await resolvePackageTarget(env, namespaceName, packageName);
  if (!target.ok) return target.response;

  const versions = ((target.package.versions ?? []) as Record<string, unknown>[])
    .map((v) => String(v.version))
    .filter((v) => v.length > 0);

  // Defect D12: v0.0.1 deleted only the package document, leaving
  // namespaces.packages[], users.authorOf and users.maintainerOf dangling —
  // and crashing GET /users/<username> when it followed a dead reference.
  await db(env, {
    kind: "transaction",
    steps: [
      { kind: "deleteOne", collection: "packages", filter: { _id: target.package._id } },
      {
        kind: "updateOne",
        collection: "namespaces",
        filter: { _id: target.namespace._id },
        update: { $pull: { packages: target.package._id } },
      },
      {
        kind: "updateMany",
        collection: "users",
        filter: {},
        update: { $pull: { authorOf: target.package._id, maintainerOf: target.package._id } },
      },
    ],
  });

  // D78: delete the R2 objects, not just metadata. The previous code collected
  // legacy GridFS `oid`s -- always empty in this architecture -- and logged
  // them, so every package tarball was orphaned forever.
  ctx.waitUntil(deletePackageTarballs(env, namespaceName, packageName, versions));

  await invalidate(env, ENTITY.package(namespaceName, packageName), ENTITY.namespacePackages(namespaceName));
  ctx.waitUntil(Promise.resolve(logger.info("package deleted", { namespaceName, packageName, tarballs: versions.length })));

  return jsonOk({ message: "Package deleted successfully" });
}

// ── POST /packages/{ns}/{pkg}/uploadToken ─────────────────────────────────────

/**
 * Package-scoped publish token.
 *
 * v0.0.1 minted these into `packages.upload_tokens` but `upload()` only ever
 * searched `db.namespaces`, so they could not authorise an upload — the dialog
 * in the UI handed out credentials that did nothing (defect D4). Now they land
 * in the same collection the upload path reads, scoped to one package.
 */
async function createPackageUploadToken(
  env: Env,
  auth: AuthContext | null,
  namespaceName: string,
  packageName: string,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const actor = await findUser(env, auth.uuid);
  if (!actor) return jsonError(404, "User not found");

  const target = await resolvePackageTarget(env, namespaceName, packageName);
  if (!target.ok) return target.response;

  if (!canPublishPackage(actor, target.namespace, target.package)) {
    return jsonForbidden();
  }

  const { issueUploadToken } = await import("../lib/upload-tokens");
  const issued = await issueUploadToken(env, {
    scope: "package",
    namespaceId: strId(target.namespace._id),
    packageId: strId(target.package._id),
    createdBy: actor.uuid,
    createdByUsername: actor.username,
  });

  // Emit both spellings. v2.0.1 used `upload_token` here and `uploadToken` on
  // the namespace route, while the frontend reads `uploadToken` for this one
  // and `upload_token` for the other (docs/API_CONTRACT.md §7.4).
  return jsonOk({
    message: "Upload token created successfully",
    upload_token: issued.token,
    uploadToken: issued.token,
  });
}

// ── PUT /packages ────────────────────────────────────────────────────────────

/**
 * Deprecate or un-deprecate. New route — `v2.0.1` had none, so the frontend's
 * `deprecatePackage` got a 405 and nothing could be reversed anyway (D26).
 *
 * The frontend sends `{uuid, name, namespace, isDeprecated: "true"}` as form
 * data; the `uuid` field is ignored because identity comes from the Bearer
 * token, exactly as on the other mutating routes.
 */
async function deprecatePackage(
  request: Request,
  env: Env,
  auth: AuthContext | null,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");
  const actor = await findUser(env, auth.uuid);
  if (!actor) return jsonError(404, "User not found");

  const body = await readBody(request);
  const namespaceName = body.get("namespace");
  const packageName = body.get("name");
  if (!namespaceName) return jsonError(400, "Please enter namespace name");
  if (!packageName) return jsonError(400, "Please enter package name");

  const target = await resolvePackageTarget(env, namespaceName, packageName);
  if (!target.ok) return target.response;

  if (!canPublishPackage(actor, target.namespace, target.package)) {
    return jsonForbidden();
  }

  // The frontend sends the literal string "true". Accept "false" too, which is
  // what makes un-deprecating possible at all.
  const raw = (body.get("isDeprecated") ?? "true").toLowerCase();
  const shouldDeprecate = raw !== "false";

  // Two updates, because the flag lives in two places and only one of them is
  // read by the client.
  //
  // The package-level flag is what search filters on, so it has to be set or a
  // deprecated package keeps appearing in results. The **version**-level flag is
  // what the API returns in `latest_version_data` and every `version_history`
  // entry, and what the frontend compares against the string "true". Setting only
  // the package flag made `PUT /packages` answer HTTP 200
  // "Package deprecated successfully" while `isDeprecated` stayed `"false"` on
  // every version, so the deprecation badge never appeared in the UI.
  //
  // That is the exact failure this migration set out to close. `v0.0.1` had no
  // deprecation route at all; adding one that reports success without changing
  // what the client reads is the same defect wearing a 200.
  await db(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: target.package._id },
    update: { $set: { is_deprecated: shouldDeprecate, updated_at: new Date() } },
  });

  await db(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: target.package._id },
    update: {
      $set: {
        // `versions` is an array of subdocuments, so the positional-all
        // operator is required -- there is no dotted path into array elements
        // for a whole-array assignment.
        "versions.$[].is_deprecated": shouldDeprecate,
        "versions.$[].isDeprecated": String(shouldDeprecate),
      },
    },
  });

  await invalidate(
    env,
    ENTITY.package(namespaceName, packageName),
    ENTITY.namespacePackages(namespaceName),
  );

  return jsonOk({
    message: shouldDeprecate ? "Package deprecated successfully" : "Package un-deprecated successfully",
  });
}

// ── POST /packages (upload) ──────────────────────────────────────────────────

/**
 * Upload.
 *
 * Authorization is the 7-day publish token, NOT a JWT — that is the existing
 * contract with `fpm publish --token` and it is preserved. What changed is that
 * the token now lives in `upload_tokens`, is scoped, is revocable, and is
 * compared by hash (defect D4).
 *
 * The bytes go to R2, streamed, with a SHA-256 computed incrementally and
 * stored on the version document — something `v2.0.1` never did at all
 * (defect D24).
 */
async function upload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Expected multipart form data");
  }

  const token = text(form, "upload_token");
  if (!token) return jsonError(400, "Upload token missing");

  const packageName = text(form, "package_name");
  const version = text(form, "package_version");
  const license = text(form, "package_license");
  const dryRun = text(form, "dry_run") === "true";
  const tarball = form.get("tarball");

  if (!packageName) return jsonError(400, "Package name is missing");
  if (!version) return jsonError(400, "Package version is missing");
  if (!license) return jsonError(400, "Package license is missing");

  // Defect D7: the package name reaches storage keys and, in the legacy
  // pipeline, `subprocess.run(shell=True)`. Validate the charset first.
  const nameCheck = validatePackageName(packageName);
  if (!nameCheck.ok) return jsonError(400, nameCheck.message);
  const versionCheck = validateVersion(version);
  if (!versionCheck.ok) return jsonError(400, versionCheck.message);
  const licenseCheck = validateLicense(license);
  if (!licenseCheck.ok) return jsonError(400, licenseCheck.message);

  if (!(tarball instanceof File) || tarball.size === 0) {
    return jsonError(400, "Tarball file is missing");
  }
  // Defect D8/S19: cap the size before anything reads the body. v2.0.1 had no
  // cap and then called `tarfile.open(...).getnames()`, fully inflating an
  // attacker-controlled gzip in-request.
  if (tarball.size > MAX_TARBALL_BYTES) {
    return jsonError(413, "Tarball exceeds the maximum upload size");
  }

  // `dry_run` must have no side effects. v2.0.1 wrote a GridFS record and a
  // tarball to disk *before* the early return, leaking one of each per call with
  // no cleanup (defect D15). Nothing at all is persisted on this path.
  if (dryRun) return jsonOk({ message: "Dry run Successful." });

  const verdict = await consumeUploadToken(env, token);
  if (!verdict.valid) {
    logger.warn("rejected upload token", { reason: verdict.reason });
    // One message for every failure mode: distinguishing them would let a
    // caller probe which tokens exist.
    return jsonError(401, "Invalid upload token");
  }

  const namespace = (await db<{ _id: unknown; namespace: string } | null>(env, {
    kind: "findOne",
    collection: "namespaces",
    filter: { _id: toHexOrId(verdict.namespaceId) },
    projection: { namespace: 1 },
  })) as { _id: unknown; namespace: string } | null;

  if (!namespace) return jsonError(404, "Namespace not found");

  const existing = (await db<(Record<string, unknown> & { _id: unknown }) | null>(env, {
    kind: "findOne",
    collection: "packages",
    filter: { name: packageName, namespace: namespace._id },
    projection: { versions: 1 },
  })) as (Record<string, unknown> & { _id: unknown }) | null;

  if (!tokenAllows(verdict, verdict.namespaceId, existing ? strId(existing._id) : null)) {
    // A package-scoped token cannot create a new package: there is no package
    // id to match against.
    return jsonError(401, "Invalid upload token");
  }

  if (existing) {
    const versions = (existing.versions ?? []) as Record<string, unknown>[];
    if (versions.some((v) => String(v.version) === version)) {
      return jsonError(400, "Version already exists");
    }
  }

  // Hash the artifact *before* touching the database or R2, so the digest can
  // go into the version document. The R2 write is deferred until after the
  // atomic append below has won: the object key is derivable, so writing first
  // would let a racing duplicate publish clobber the winner's object while the
  // database records the winner's sha256 (D77).
  let bytes: Uint8Array;
  let total: number;
  let sha256: string;
  try {
    ({ bytes, total, sha256 } = await hashTarball(tarball.stream(), tarball.size));
  } catch (err) {
    if (err instanceof TarballTooLarge) {
      return jsonError(413, "Tarball exceeds the maximum upload size");
    }
    logger.error("tarball hash failed", { message: err instanceof Error ? err.message : String(err) });
    return jsonError(400, "Invalid tarball file");
  }
  const stored: StoredTarball = {
    key: tarballKey(namespace.namespace, packageName, version),
    size: total,
    sha256,
  };

  // Write the artifact to R2, and on failure roll back whatever the atomic
  // guard above added, so a version can never be advertised without its bytes.
  const persistTarball = async (): Promise<Response | null> => {
    try {
      await putTarballBytes(env, stored.key, bytes, stored.sha256);
      return null;
    } catch (err) {
      logger.error("r2 put failed", { message: err instanceof Error ? err.message : String(err) });
      return jsonError(400, "Invalid tarball file");
    }
  };

  const now = new Date();
  const versionDoc = {
    version,
    tarball: `${packageName}-${version}.tar.gz`,
    dependencies: "",
    created_at: now,
    is_deprecated: false,
    // The new, derivable key. The old `/tarballs/<ObjectId>` shape is still
    // routed by routes/tarballs.ts so existing links keep working.
    download_url: `/tarballs/${namespace.namespace}/${packageName}/${version}`,
    sha256: stored.sha256,
    size: stored.size,
    is_verified: false,
    // The upload pipeline cannot validate a tarball inside a 10 ms CPU budget,
    // so an uploaded version starts unverified and GitHub Actions (Phase 8)
    // flips this.
    unable_to_verify: true,
  };

  /**
   * Append this version to an existing package document, unless it is already
   * there.
   *
   * The `"versions.version": { $ne: version }` clause is load-bearing. A bare
   * `$push` is atomic but not idempotent, so eight concurrent publishes of the
   * *same* version insert eight identical entries -- measured at six copies after
   * the duplicate-key race was fixed, which then surfaces in `version_history` as
   * 1.0.0 repeated. Folding the guard into the filter keeps it atomic: exactly one
   * request matches and pushes, the rest match zero documents and are told the
   * version already exists.
   */
  const appendVersion = async (packageId: unknown): Promise<boolean> => {
    const result = (await db<{ modifiedCount: number }>(env, {
      kind: "updateOne",
      collection: "packages",
      filter: versionAppendFilter(packageId, version),
      update: {
        $push: { versions: versionDoc },
        $set: { updated_at: now, license },
      },
    })) as { modifiedCount: number };
    return (result?.modifiedCount ?? 0) > 0;
  };

  if (existing) {
    if (!(await appendVersion(existing._id))) {
      return jsonError(400, `Version ${version} of ${packageName} already exists`);
    }
    const fail = await persistTarball();
    if (fail) {
      // Roll back the version we just appended: without its R2 object the
      // version is unusable and its sha256 would never be reproducible.
      await db(env, {
        kind: "updateOne",
        collection: "packages",
        filter: { _id: existing._id },
        update: { $pull: { versions: { version } } },
      });
      return fail;
    }
  } else {
    const uploader = await db<(Record<string, unknown> & { _id: unknown }) | null>(env, {
      kind: "findOne",
      collection: "users",
      filter: { uuid: verdict.createdBy },
      projection: { _id: 1 },
    }) as (Record<string, unknown> & { _id: unknown }) | null;

    const document = {
        name: packageName,
        namespace: namespace._id,
        namespace_name: namespace.namespace,
        description: "Package Under Verification",
        registry_description: null,
        homepage: "Package Under Verification",
        repository: "Package Under Verification",
        copyright: "Package Under Verification",
        license,
        author: uploader?._id,
        maintainers: uploader?._id ? [uploader._id] : [],
        keywords: ["fortran", "fpm"],
        categories: ["fortran", "fpm"],
        is_deprecated: false,
        is_verified: false,
        is_malicious: false,
        unable_to_verify: true,
        security_status: "No security issues found",
        download_count: 0,
        ratings: { users: {}, counts: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }, avg_ratings: 0 },
        malicious_report: { users: {}, isViewed: false },
        created_at: now,
        updated_at: now,
        versions: [versionDoc],
      };

    let inserted: { insertedId: unknown };
    try {
      inserted = (await db<{ insertedId: unknown }>(env, {
        kind: "insertOne",
        collection: "packages",
        doc: document,
      })) as { insertedId: unknown };
    } catch (err) {
      // Lost the create race.
      //
      // `packages_name_namespace_unique` is a unique index on (name, namespace),
      // so of several concurrent first publishes of the same package exactly one
      // insert wins and the rest get a duplicate-key error. Measured: five parallel
      // publishes of five different versions left **one** version on the package
      // and failed the other four outright.
      //
      // That is the index doing its job, but failing the publish is the wrong
      // response to it. The package now exists and is exactly where this version
      // belongs, so fold the version in with an atomic `$push` rather than
      // returning an error the client cannot act on. This matters in practice: a
      // CI matrix publishing several versions of one package at once would lose
      // all but one.
      if (!isDuplicateKeyError(err)) throw err;

      const now_ = await db<{ _id: unknown } | null>(env, {
        kind: "findOne",
        collection: "packages",
        filter: { name: packageName, namespace: namespace._id },
        projection: { _id: 1 },
      });
      if (!now_) throw err; // genuinely gone again; surface the original failure
      logger.warn("publish lost the create race; appending to the existing package", {
        package: `${namespace.namespace}/${packageName}`,
        version,
      });
      if (!(await appendVersion(now_._id))) {
        return jsonError(400, `Version ${version} of ${packageName} already exists`);
      }
      {
        const fail = await persistTarball();
        if (fail) {
          await db(env, {
            kind: "updateOne",
            collection: "packages",
            filter: { _id: now_._id },
            update: { $pull: { versions: { version } } },
          });
          return fail;
        }
      }
      await invalidate(
        env,
        ENTITY.package(namespace.namespace, packageName),
        ENTITY.namespacePackages(namespace.namespace),
      );
      return jsonOk({ message: "Package Uploaded Successfully." });
    }

    {
      const fail = await persistTarball();
      if (fail) {
        await db(env, {
          kind: "deleteOne",
          collection: "packages",
          filter: { _id: inserted.insertedId },
        });
        return fail;
      }
    }

    await db(env, {
      kind: "updateOne",
      collection: "namespaces",
      filter: { _id: namespace._id },
      update: { $push: { packages: inserted.insertedId }, $set: { updatedAt: now } },
    });
    if (uploader?._id) {
      await db(env, {
        kind: "updateOne",
        collection: "users",
        filter: { _id: uploader._id },
        update: { $addToSet: { authorOf: inserted.insertedId } },
      });
    }
  }

  // Retire every cached view of this package and of the namespace's package
  // list, so the new version appears immediately rather than after a TTL.
  await invalidate(
    env,
    ENTITY.package(namespace.namespace, packageName),
    ENTITY.namespace(namespace.namespace),
    ENTITY.namespacePackages(namespace.namespace),
  );

  ctx.waitUntil(
    Promise.resolve(
      logger.info("package uploaded", {
        namespace: namespace.namespace,
        packageName,
        version,
        bytes: stored.size,
        sha256: stored.sha256.slice(0, 12),
      }),
    ),
  );

  return jsonOk({ message: "Package Uploaded Successfully." });
}

// ── helpers ───────────────────────────────────────────────────────────────────

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export { escapeRegex, clampInt, SORT_MAP, MAX_PAGE_SIZE };