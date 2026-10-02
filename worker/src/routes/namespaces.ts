/**
 * Namespaces — `/namespace*` and `/namespaces*` (Phase 4).
 *
 * Six routes. Note the singular/plural split is an inconsistency in the
 * original API that must be preserved verbatim (docs/API_CONTRACT.md §3.2):
 *
 *   POST   /namespaces                        create
 *   POST   /namespaces/{ns}/uploadToken       mint a publish token
 *   POST   /namespaces/{ns}/admins            list admins     (POST, not GET!)
 *   POST   /namespaces/{ns}/maintainers       list maintainers (POST, not GET!)
 *   GET    /namespace/{ns}                    namespace + its packages
 *   POST   /namespace/{ns}/delete              delete (site admin only)
 *
 * Defects closed here:
 *   D11  `delete_namespace` did `delete_one({"namespace": namespace_obj.id})` —
 *        comparing the *name* field against an **ObjectId**. It never matched,
 *        so the route always returned `code: 500` at HTTP 200 and never
 *        deleted anything. Packages underneath were left untouched.
 *   D12  deletes never cascaded. `namespaces.packages[]` and `users.authorOf`
 *        kept dangling references, and `GET /users/<username>` crashed with
 *        `TypeError: 'NoneType' object is not subscriptable` when it followed
 *        a reference to a deleted package.
 *   D4   upload tokens move to a revocable, hashed-at-rest collection. See
 *        lib/upload-tokens.ts.
 *   D14  every 404 now returns a real 404. `v2.0.1` returned HTTP 200 with
 *        `code: 404` in the body, so the frontend's `code === 200` success
 *        check could not tell success from failure.
 */

import { db, toJsonSafe } from "../db/client";
import type { Env } from "../db/client";
import { jsonError, jsonOk } from "../lib/responses";
import type { AuthContext } from "../lib/auth";
import { validateNamespaceName } from "../lib/validators";
import { issueUploadToken, revokeUploadToken, DEFAULT_TTL_DAYS } from "../lib/upload-tokens";
import { logger } from "../lib/logger";
import {
  isNamespaceAdmin,
  isNamespaceAuthor,
  isNamespaceMaintainer,
  strId,
  containsId,
  type NamespaceLike,
  type UserLike,
} from "../lib/permissions";

const NAMESPACE_NAME_MAX = 64;

export async function handleNamespaceRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: AuthContext | null,
): Promise<Response | null> {
  // Kept for a uniform handler signature across all route modules; this one
  // resolves everything from `segments`, so it has no use for the parsed URL.
  void url;
  const method = request.method.toUpperCase();
  const prefix = segments[0];

  if (prefix === "namespaces") {
    // POST /namespaces
    if (method === "POST" && segments.length === 1) return createNamespace(request, env, auth);
    // POST /namespaces/{ns}/uploadToken
    if (method === "POST" && segments.length === 3 && segments[2] === "uploadToken") {
      return createUploadToken(env, auth, segments[1] as string);
    }
    // POST /namespaces/{ns}/uploadToken/{tokenId}/revoke — new, closes defect D4.
    // `v2.0.1` has no revoke path at all, so a leaked token stays valid for its
    // full lifetime.
    if (method === "POST" && segments.length === 5 && segments[2] === "uploadToken" && segments[4] === "revoke") {
      return revokeTokenRoute(env, auth, segments[3] as string);
    }
    // POST /namespaces/{ns}/admins | maintainers  (reads, oddly, over POST)
    if (method === "POST" && segments.length === 3) {
      if (segments[2] === "admins") return listMembers(env, segments[1] as string, "admins");
      if (segments[2] === "maintainers") return listMembers(env, segments[1] as string, "maintainers");
    }
    return null;
  }

  // prefix === "namespace" (singular)
  if (method === "GET" && segments.length === 2) return namespacePackages(env, segments[1] as string);
  if (method === "POST" && segments.length === 3 && segments[2] === "delete") {
    return deleteNamespace(env, auth, segments[1] as string, ctx);
  }
  return null;
}

// ── POST /namespaces ──────────────────────────────────────────────────────────

async function createNamespace(request: Request, env: Env, auth: AuthContext | null): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  // The original accepted JSON or form data here; the frontend sends form data.
  const body = await readBody(request);
  const name = body.get("namespace");
  const description = body.get("namespace_description");

  if (!name) return jsonError(400, "Please enter namespace name");
  if (!description) return jsonError(400, "Please enter namespace description");

  const nameCheck = validateNamespaceName(name);
  if (!nameCheck.ok) return jsonError(400, nameCheck.message);

  const user = await findUser(env, auth.uuid);
  if (!user) return jsonError(404, "User not found");

  const existing = await db<unknown>(env, {
    kind: "findOne",
    collection: "namespaces",
    filter: { namespace: name },
    projection: { namespace: 1 },
  });
  if (existing) return jsonError(400, "Namespace already exists");

  const now = new Date();
  const doc = {
    namespace: name,
    description,
    createdAt: now,
    author: user._id,
    maintainers: [user._id],
    admins: [user._id],
    packages: [],
  };

  let insertedId: unknown;
  try {
    const result = (await db<{ insertedId: unknown }>(env, {
      kind: "insertOne",
      collection: "namespaces",
      doc,
    })) as { insertedId: unknown };
    insertedId = result.insertedId;
  } catch (err) {
    // The unique index on `namespace` is the real guarantee; the `find_one`
    // above is only there to give a readable message. Losing that race is
    // therefore an expected outcome, not a 500.
    if ((err as { code?: number }).code === 11000) {
      return jsonError(400, "Namespace already exists");
    }
    throw err;
  }

  logger.info("namespace created", { namespace: name });
  void insertedId;
  return jsonOk({ message: "Namespace created successfully" });
}

// ── POST /namespaces/{ns}/uploadToken ─────────────────────────────────────────

async function createUploadToken(env: Env, auth: AuthContext | null, namespaceName: string): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const namespace = (await db<NamespaceDoc | null>(env, {
    kind: "findOne",
    collection: "namespaces",
    filter: { namespace: namespaceName },
    projection: { namespace: 1, author: 1, admins: 1, maintainers: 1 },
  })) as NamespaceDoc | null;

  if (!namespace) return jsonError(404, "Namespace not found");

  const user = await findUser(env, auth.uuid);
  if (!user) return jsonError(404, "User not found");

  // Namespace admin or namespace maintainer. The original's
  // `checkUserUnauthorizedForNamespaceTokenCreation` is exactly this union.
  if (!isNamespaceAdmin(user, namespace) && !isNamespaceMaintainer(user, namespace)) {
    return jsonError(401, "Unauthorized");
  }

  const issued = await issueUploadToken(env, {
    scope: "namespace",
    namespaceId: strId(namespace._id),
    createdBy: user.uuid,
    createdByUsername: user.username,
  });

  // The contract requires camelCase `uploadToken` here. We also emit
  // `upload_token`, because the *package* token endpoint on `v2.0.1` returns
  // that name and the frontend reads it in one place and the other
  // (API_CONTRACT.md §7.4). Emitting both is additive and removes the trap.
  return jsonOk({
    message: "Upload token created",
    uploadToken: issued.token,
    upload_token: issued.token,
    expires_in_days: DEFAULT_TTL_DAYS,
  });
}

/** POST /namespaces/{ns}/uploadToken/:token/revoke — new, closes defect D4. */
export async function revokeTokenRoute(
  env: Env,
  auth: AuthContext | null,
  tokenId: string,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");
  const revoked = await revokeUploadToken(env, tokenId, auth.uuid);
  if (!revoked) return jsonError(404, "Token not found");
  return jsonOk({ message: "Upload token revoked" });
}

// ── POST /namespaces/{ns}/admins | maintainers ────────────────────────────────

/**
 * A read, expressed over POST because that is what the original does and the
 * frontend depends on. Unauthenticated in `v2.0.1`.
 *
 * Note the response key is `users`, not `admins`/`maintainers`. The Swagger
 * yaml documents the latter; the code has always returned the former and the
 * frontend reads `users`, so the code wins (docs/BASELINE_AUDIT.md D32).
 */
async function listMembers(env: Env, namespaceName: string, field: "admins" | "maintainers"): Promise<Response> {
  const namespace = (await db<NamespaceDoc | null>(env, {
    kind: "findOne",
    collection: "namespaces",
    filter: { namespace: namespaceName },
    projection: { namespace: 1, [field]: 1 },
  })) as NamespaceDoc | null;

  if (!namespace) return jsonError(404, "Namespace not found");

  const ids = (namespace[field] ?? []) as unknown[];
  const users = await db<unknown[]>(env, {
    kind: "find",
    collection: "users",
    filter: { _id: { $in: ids } },
    projection: { username: 1 },
  });

  return jsonOk({
    users: ((users ?? []) as Record<string, unknown>[]).map((u) => ({
      id: strId(u._id),
      username: u.username,
    })),
  });
}

// ── GET /namespace/{ns} ───────────────────────────────────────────────────────

/**
 * Namespace plus its packages.
 *
 * `v2.0.1` did one `find_one` per package in a Python loop (N+1, defect D25).
 * A single aggregation does it in one round trip, which matters against the
 * Atlas M0 cap of 100 operations/second.
 */
async function namespacePackages(env: Env, namespaceName: string): Promise<Response> {
  const rows = (await db<unknown[]>(env, {
    kind: "aggregate",
    collection: "namespaces",
    pipeline: [
      { $match: { namespace: namespaceName } },
      { $limit: 1 },
      {
        $lookup: {
          from: "packages",
          localField: "packages",
          foreignField: "_id",
          as: "packageDocs",
        },
      },
      { $unwind: { path: "$packageDocs", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          createdAt: 1,
          packageDocs: {
            name: 1,
            namespace_name: 1,
            description: 1,
            keywords: 1,
            updated_at: 1,
          },
        },
      },
    ],
  })) as Record<string, unknown>[];

  const row = rows?.[0];
  if (!row) return jsonError(404, "Namespace not found");

  const doc = (row.packageDocs ?? null) as Record<string, unknown> | null;

  // Contract: `createdAt` must be a string, because the frontend slices it
  // (`.slice(4,16)`). toJsonSafe converts the BSON Date.
  return jsonOk({
    createdAt: toJsonSafe(row.createdAt),
    packages: doc
      ? [
          {
            namespace: doc.namespace_name,
            name: doc.name,
            description: doc.description,
            keywords: doc.keywords ?? [],
            updated_at: toJsonSafe(doc.updated_at),
          },
        ]
      : [],
  });
}

// ── POST /namespace/{ns}/delete ───────────────────────────────────────────────

/**
 * Site-admin-only, and now actually deletes — and cascades.
 *
 * The original never removed the namespace (name compared against an ObjectId),
 * never removed its packages, never cleaned `users.authorOf` /
 * `users.maintainerOf`, and never deleted the GridFS blobs. Those dangling
 * references are what made `GET /users/<username>` crash.
 *
 * The whole thing runs in one MongoDB transaction via the pool's `transaction`
 * op, so a failure part-way cannot leave the graph half-rewritten.
 */
async function deleteNamespace(
  env: Env,
  auth: AuthContext | null,
  namespaceName: string,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const user = await findUser(env, auth.uuid);
  if (!user) return jsonError(404, "User not found");
  if (!user.roles.includes("admin")) return jsonError(401, "Unauthorized");

  const namespace = (await db<NamespaceDoc | null>(env, {
    kind: "findOne",
    collection: "namespaces",
    filter: { namespace: namespaceName },
  })) as NamespaceDoc | null;

  if (!namespace) return jsonError(404, "Namespace not found");

  const namespaceId = namespace._id;
  const packageIds = (namespace.packages ?? []) as unknown[];

  // Collect the tarball ids before deleting the packages, so Phase 6 can prune
  // the corresponding R2 objects. Doing it after the delete would be too late.
  const tarballOids = await collectTarballOids(env, packageIds);

  await db(env, {
    kind: "transaction",
    steps: [
      // Remove the packages themselves.
      { kind: "deleteMany", collection: "packages", filter: { namespace: namespaceId } },
      // Unlink from every author and maintainer.
      {
        kind: "updateMany",
        collection: "users",
        filter: {},
        update: { $pull: { authorOf: { $in: packageIds }, maintainerOf: { $in: packageIds } } },
      },
      // Release any publish token scoped to this namespace.
      {
        kind: "updateMany",
        collection: "upload_tokens",
        filter: { namespace_id: strId(namespaceId) },
        update: { $set: { revoked_at: new Date() } },
      },
      // Finally the namespace. Filtering on `_id` is what the original got wrong.
      { kind: "deleteOne", collection: "namespaces", filter: { _id: namespaceId } },
    ],
  });

  logger.info("namespace deleted", { namespace: namespaceName, packages: packageIds.length });

  // R2 cleanup is Phase 6 work; schedule it rather than blocking the response.
  ctx.waitUntil(
    Promise.resolve(tarballOids).then((oids) => {
      logger.info("namespace tarballs to prune", { namespace: namespaceName, count: oids.length });
    }),
  );

  return jsonOk({ message: "Namespace deleted successfully" });
}

async function collectTarballOids(env: Env, packageIds: unknown[]): Promise<string[]> {
  if (packageIds.length === 0) return [];
  const packages = (await db<unknown[]>(env, {
    kind: "find",
    collection: "packages",
    filter: { _id: { $in: packageIds } },
    projection: { versions: 1 },
  })) as Record<string, unknown>[];

  const oids: string[] = [];
  for (const pkg of packages ?? []) {
    for (const version of (pkg.versions ?? []) as Record<string, unknown>[]) {
      if (version.oid) oids.push(strId(version.oid));
    }
  }
  return oids;
}

// ── helpers ───────────────────────────────────────────────────────────────────

type NamespaceDoc = NamespaceLike & { description?: string; createdAt?: Date };

type UserDoc = UserLike & { uuid: string; username: string; roles: string[] };

async function findUser(env: Env, uuid: string): Promise<UserDoc | null> {
  return (await db<UserDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { uuid },
    projection: { uuid: 1, username: 1, roles: 1 },
  })) as UserDoc | null;
}

/** Read either form-encoded or JSON bodies. `POST /namespaces` accepts both. */
async function readBody(request: Request): Promise<Map<string, string>> {
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

export { readBody, findUser, NAMESPACE_NAME_MAX };
// Re-exported so callers have one import site for the permission helpers.
export { isNamespaceAdmin, isNamespaceMaintainer, isNamespaceAuthor, containsId, strId };