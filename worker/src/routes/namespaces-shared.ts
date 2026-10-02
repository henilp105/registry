/**
 * Shared route helpers.
 *
 * Extracted so `packages.ts` can reuse the body reader and the user loader from
 * `namespaces.ts` without importing the namespace routes (and creating an
 * import cycle), and so the package-target resolution has one home.
 */

import { db, type Env } from "../db/client";
import { jsonError } from "../lib/responses";
import { strId, type NamespaceLike, type UserLike } from "../lib/permissions";

/** Read either form-encoded or JSON bodies into a trimmed string map. */
export async function readBody(request: Request): Promise<Map<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const parsed = (await request.json()) as Record<string, unknown>;
      const out = new Map<string, string>();
      for (const [k, v] of Object.entries(parsed ?? {})) {
        if (typeof v === "string" && v.trim()) out.set(k, v.trim());
        else if (typeof v === "number" || typeof v === "boolean") out.set(k, String(v));
      }
      return out;
    } catch {
      return new Map();
    }
  }

  try {
    const form = await request.formData();
    const out = new Map<string, string>();
    for (const [k, v] of form.entries()) {
      if (typeof v === "string" && v.trim()) out.set(k, v.trim());
    }
    return out;
  } catch {
    return new Map();
  }
}

export type UserDoc = UserLike & { uuid: string; username: string; roles: string[] };

export async function findUser(env: Env, uuid: string): Promise<UserDoc | null> {
  if (!uuid) return null;
  return (await db<UserDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { uuid },
    projection: { uuid: 1, username: 1, roles: 1, _id: 1 },
  })) as UserDoc | null;
}

export type PackageDoc = {
  _id: unknown;
  name: string;
  namespace: unknown;
  namespace_name: string;
  description?: string;
  registry_description?: string | null;
  homepage?: string;
  repository?: string;
  copyright?: string;
  license?: string;
  author?: unknown;
  maintainers?: unknown[];
  keywords?: string[];
  categories?: string[];
  is_deprecated?: boolean;
  is_verified?: boolean;
  is_malicious?: boolean;
  unable_to_verify?: boolean;
  security_status?: string;
  created_at?: Date;
  updated_at?: Date;
  download_count?: number;
  ratings?: unknown;
  versions?: Record<string, unknown>[];
};

export type ResolvedTarget =
  | { ok: true; package: PackageDoc; namespace: NamespaceLike; authorUsername: string | null }
  | { ok: false; response: Response };

/**
 * Resolve `(namespaceName, packageName)` to a package plus its namespace.
 *
 * ── This is the fix for defect D34 ───────────────────────────────────────────
 * `v0.0.1` resolved a package with:
 *
 *     db.packages.find_one({"name": package_name, "namespace": namespace_name})
 *
 * But `packages.namespace` holds an **ObjectId**, never the namespace name. So
 * that query matched nothing, and `POST /packages/<ns>/<pkg>/verify` returned
 * 404 for every package. The frontend reads `isVerified` off the response and
 * therefore never showed its role-gated controls at all.
 *
 * The fix is to resolve the namespace to its `_id` first, then query the
 * package by that id — one namespace lookup, then one package lookup, both
 * index-backed (`namespaces.namespace` unique, `packages(name, namespace)`
 * unique from Phase 2).
 */
export async function resolvePackageTarget(
  env: Env,
  namespaceName: string,
  packageName: string,
): Promise<ResolvedTarget> {
  const namespace = (await db<NamespaceLike | null>(env, {
    kind: "findOne",
    collection: "namespaces",
    filter: { namespace: namespaceName },
    projection: { namespace: 1, author: 1, admins: 1, maintainers: 1, packages: 1 },
  })) as NamespaceLike | null;

  if (!namespace) return { ok: false, response: jsonError(404, "Namespace not found") };

  const pkg = (await db<PackageDoc | null>(env, {
    kind: "findOne",
    collection: "packages",
    filter: { name: packageName, namespace: namespace._id },
    projection: {
      name: 1,
      namespace: 1,
      namespace_name: 1,
      description: 1,
      registry_description: 1,
      homepage: 1,
      repository: 1,
      copyright: 1,
      license: 1,
      author: 1,
      maintainers: 1,
      keywords: 1,
      categories: 1,
      is_deprecated: 1,
      is_verified: 1,
      is_malicious: 1,
      unable_to_verify: 1,
      security_status: 1,
      created_at: 1,
      updated_at: 1,
      download_count: 1,
      ratings: 1,
      versions: 1,
    },
  })) as PackageDoc | null;

  if (!pkg) return { ok: false, response: jsonError(404, "Package not found") };

  // `namespace_name` is denormalised onto the package, but older documents may
  // predate it, so fall back to the resolved namespace's name.
  if (!pkg.namespace_name) pkg.namespace_name = namespace.namespace;

  let authorUsername: string | null = null;
  if (pkg.author) {
    const author = (await db<{ username?: string } | null>(env, {
      kind: "findOne",
      collection: "users",
      filter: { _id: pkg.author },
      projection: { username: 1 },
    })) as { username?: string } | null;
    authorUsername = author?.username ?? null;
  }

  return { ok: true, package: pkg, namespace, authorUsername };
}

export { strId };