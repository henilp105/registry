/**
 * MongoDB index definitions.
 *
 * Ported from `backend/mongo.py::ensure_indexes()` on `v2.0.1` and extended.
 *
 * Why this matters, measured on this repo:
 *   - MongoDB Atlas Free (M0) is capped at **100 operations/second**. An
 *     unindexed `find` over the `packages` collection is one collection scan
 *     per request, and the search endpoint runs two (`find` + `countDocuments`).
 *   - Without the unique indexes, namespace/package/token uniqueness is only
 *     enforced by an application-level `find_one`, which is a TOCTOU race
 *     (defect D17 in docs/BASELINE_AUDIT.md).
 *
 * `v2.0.1` already creates a weighted text index over
 * `name, description, registry_description, keywords, categories` — but the
 * search code never queries it (defect D18), preferring unescaped `$regex`
 * instead. We keep the index and, in Phase 7, actually use it.
 *
 * ── A note on the Atlas 100 ops/sec limit ─────────────────────────────────────
 * Reads count against that cap, so a text index that avoids a full collection
 * scan is not merely a latency optimisation here — it is what keeps the free
 * tier inside its budget. That is the concrete sense in which this migration
 * is "faster edge" work and not just a hosting move.
 */

import type { IndexSpec } from "./mongo-pool";

/**
 * Order matters: `{name, namespace}` mirrors the uniqueness rule the upload
 * path enforced with a racy `find_one`, and `namespace` is an ObjectId there.
 */
export const INDEX_SPEC: IndexSpec[] = [
  {
    collection: "users",
    indexes: [
      // `sparse` preserves v2.0.1 behaviour for documents predating `uuid`.
      { key: { uuid: 1 }, name: "users_uuid_unique", unique: true, sparse: true },
      { key: { username: 1 }, name: "users_username_unique", unique: true },
      { key: { email: 1 }, name: "users_email_unique", unique: true },
      { key: { isVerified: 1 }, name: "users_isVerified" },
      // Supports `GET /users/<username>` and the admin dashboard listings.
      { key: { roles: 1 }, name: "users_roles" },
    ],
  },
  {
    collection: "packages",
    indexes: [
      { key: { name: 1, namespace: 1 }, name: "packages_name_namespace_unique", unique: true },
      { key: { namespace_name: 1, is_deprecated: 1 }, name: "packages_ns_deprecated" },
      { key: { author: 1 }, name: "packages_author" },
      { key: { is_deprecated: 1 }, name: "packages_is_deprecated" },
      { key: { updated_at: -1 }, name: "packages_updated_at_desc" },
      { key: { created_at: -1 }, name: "packages_created_at_desc" },
      // Denormalised download counter so `sorted_by=downloads` can sort in the
      // database instead of joining to GridFS metadata on every request.
      { key: { download_count: -1 }, name: "packages_download_count_desc" },
      // Version-lookup: `POST /packages/<ns>/<pkg>/<v>/delete` and the
      // duplicate-version check both filter on this array.
      { key: { "versions.version": 1 }, name: "packages_versions_version" },
      // Weighted text index, carried over from v2.0.1. Finally queried in
      // Phase 7 instead of being created and then ignored.
      {
        key: { name: "text", description: "text", registry_description: "text", keywords: "text", categories: "text" },
        name: "packages_text",
        weights: { name: 10, keywords: 5, categories: 5, description: 3, registry_description: 1 },
        default_language: "english",
      },
    ],
  },
  {
    collection: "namespaces",
    indexes: [
      { key: { namespace: 1 }, name: "namespaces_namespace_unique", unique: true },
      { key: { author: 1 }, name: "namespaces_author" },
      { key: { admins: 1 }, name: "namespaces_admins" },
      { key: { maintainers: 1 }, name: "namespaces_maintainers" },
    ],
  },
  {
    // Defect D4: upload tokens move out of embedded arrays on
    // `namespaces.upload_tokens[]` into their own collection so they can be
    // single-use, revocable, hashed at rest, and swept by a cron trigger.
    collection: "upload_tokens",
    indexes: [
      // Store the SHA-256 of the token, never the token itself.
      { key: { token_hash: 1 }, name: "upload_tokens_hash_unique", unique: true },
      // Drives the expiry sweep.
      { key: { expires_at: 1 }, name: "upload_tokens_expires_at" },
      { key: { namespace_id: 1 }, name: "upload_tokens_namespace" },
      { key: { package_id: 1 }, name: "upload_tokens_package" },
      { key: { created_by: 1 }, name: "upload_tokens_created_by" },
    ],
  },
  {
    // Defect D13: malicious reports leave the package document so `/report/view`
    // can actually flip triage state instead of re-returning the same reports.
    collection: "malicious_reports",
    indexes: [
      { key: { package_id: 1, is_viewed: 1 }, name: "reports_pkg_viewed" },
      { key: { reported_by: 1 }, name: "reports_reported_by" },
      { key: { created_at: -1 }, name: "reports_created_at" },
    ],
  },
  // Defect D81: the legacy GridFS index spec is dropped. `tarballs.files` no
  // longer exists (Phase 6 moved artifacts to R2), and createIndexes against a
  // namespace the bootstrap never materialised fails on Atlas M0 with
  // 'Expected createIndexes to be string, but got <nil>' every hourly cron.
];

/**
 * Collections the serverless API uses, for documentation and for the health
 * report. See `COLLECTIONS` in `client.ts`.
 */
export const EXPECTED_COLLECTIONS = [
  "users",
  "packages",
  "namespaces",
  "upload_tokens",
  "malicious_reports",
] as const;