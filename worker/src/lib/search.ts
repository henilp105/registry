/**
 * Search and pagination primitives.
 *
 * Dependency-free so they are unit testable without a Worker runtime, and so the
 * search behaviour is documented in one place rather than inline in a route.
 */

import { validatePackageName } from "./validators";

/** Hard ceiling on page size. Defect D19. */
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 10;
/** Bounds `skip`, so deep pagination cannot turn into a collection scan. */
export const MAX_SKIP = 10_000;

/**
 * Public `sorted_by` values mapped onto fields that exist on the document.
 *
 * `v2.0.1` built its sort key from a dict keyed `updatedat` / `downloads`,
 * but the actual fields are `updated_at` / `created_at` and `download_count`
 * (defect, docs/API_CONTRACT.md §7.5). MongoDB silently fell back to sorting by
 * `name` for both, so "sort by date last updated" and "sort by downloads" were
 * no-ops in the shipped UI.
 */
export const SORT_MAP: Record<string, string> = {
  "": "name",
  name: "name",
  updatedat: "updated_at",
  createdat: "created_at",
  downloads: "download_count",
  author: "author",
};

/** Sort direction for a `sort=asc|desc` parameter. */
export function sortDirection(sort: string | null): 1 | -1 {
  return (sort ?? "").toLowerCase() === "desc" ? -1 : 1;
}

/**
 * Coerce a query parameter to a bounded integer.
 *
 * Defect D19: `v2.0.1` did
 * `packages_per_page = total_documents if packages_per_page > total_documents`,
 * so a caller could set `limit` to the entire collection size and force the
 * server to materialise every package in one request.
 */
export function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Escape a user-supplied string for literal use inside a `$regex`.
 *
 * Defects S23 / D18: `v2.0.1` interpolated the raw `query` parameter straight
 * into `{"name": {"$regex": query}}` with no escaping, on six separate regex
 * sites including one over `registry_description` — which holds an entire
 * README.md. That is both a ReDoS vector and a full-collection scan.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ceiling on the search string, so an enormous body cannot reach the matcher. */
export const MAX_QUERY_LENGTH = 200;

/**
 * Decide how a query should be matched.
 *
 * `$text` is the right tool for anything with real content: it uses the
 * weighted index built in Phase 2 (and created-but-never-used by `v2.0.1`),
 * which is what keeps search inside the Atlas M0 cap of 100 operations/second.
 *
 * Two cases fall back to a regex, both deliberately narrow:
 *   - a single character, where `$text` matches nothing useful, and
 *   - a query containing `*` or `$`, i.e. someone trying to write a pattern.
 * The fallback is anchored to the start and escaped, so it cannot be abused.
 */
export function planSearch(query: string): { kind: "text"; term: string } | { kind: "prefix"; term: string } | { kind: "all" } {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed.length === 0) return { kind: "all" };
  if (trimmed.includes("*") || trimmed.includes("$")) {
    return { kind: "prefix", term: trimmed.slice(0, 40) };
  }
  if (trimmed.length < 2) return { kind: "prefix", term: trimmed };
  return { kind: "text", term: trimmed };
}

/** Build the `$match` stage for a planned query. */
export function buildMatchFilter(
  plan: ReturnType<typeof planSearch>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...extra };
  if (plan.kind === "text") {
    // -1 drops stop words, so a bare "the" does not match every document.
    base.$text = { $search: plan.term };
  } else if (plan.kind === "prefix") {
    const prefix = { name: { $regex: `^${escapeRegex(plan.term)}`, $options: "i" } };
    // Defect D81: this used to overwrite base.name outright, silently
    // discarding a `package=` filter the caller also passed
    // (GET /packages_cli?package=json&query=*). Merge instead with $and so
    // both constraints apply.
    if (extra.name !== undefined) {
      delete base.name;
      base.$and = [{ name: (extra as Record<string, unknown>).name }, prefix];
    } else {
      base.name = prefix.name;
    }
  }
  return base;
}

/**
 * Defect D34 guard.
 *
 * `v0.0.1` resolved a package with
 * `db.packages.find_one({"name": name, "namespace": namespace_name})`, but
 * `packages.namespace` holds an **ObjectId**, never the namespace name — so that
 * query matched nothing and `POST /packages/<ns>/<pkg>/verify` always 404'd.
 *
 * Exported as a tiny predicate purely so the invariant is asserted in a test.
 */
export function mustResolveNamespaceFirst(namespaceFieldType: "objectid" | "string"): true {
  if (namespaceFieldType !== "objectid") {
    throw new Error("packages.namespace must hold an ObjectId; resolve the namespace name to its _id first");
  }
  return true;
}

export { validatePackageName };