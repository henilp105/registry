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
import {
  jsonError,
  jsonForbidden,
  jsonOk,
} from "../lib/responses";
import type { AuthContext } from "../lib/auth";
import { validateNamespaceName } from "../lib/validators";
import { isDuplicateKeyError } from "../lib/publish";
import { issueUploadToken, revokeUploadToken, DEFAULT_TTL_DAYS } from "../lib/upload-tokens";
import { logger } from "../lib/logger";
import { deletePackageTarballs } from "../lib/storage";
// ── deduplicated (defect D73) ─────────────────────────────────────────────────
//
// `readBody` and `findUser` used to be defined here *and* exported from
// `./namespaces-shared`, which `packages.ts` and `ratings.ts` import. Two copies of
// the same helper is what produced D68, where a local `contains` was called with
// its arguments swapped so that every namespace-admin flag read false forever --
// the signature sat a few lines below the use, so nothing on that page looked
// wrong.
//
// The shared `readBody` was byte-identical. The shared `findUser` is strictly
// better: it rejects an empty `uuid` before querying, and asks for `_id`
// explicitly instead of relying on Mongo including it by default in an inclusion
// projection. One implementation now serves all three route modules.
import { readBody, findUser } from "./namespaces-shared";

import {
  isNamespaceAdmin,
  isNamespaceAuthor,
  isNamespaceMaintainer,
  strId,
  containsId,
  type NamespaceLike,
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
    // err.code does not survive the Durable-Object RPC boundary; match on
    // the stable E11000 message prefix like the publish path does.
    if (isDuplicateKeyError(err)) {
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
    return jsonForbidden();
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
        // Join on `_id` -> `packages.namespace`, which is the real foreign key:
        // `upload` writes `namespace: namespace._id` into the package document.
        //
        // The previous form joined `namespaces.packages` -- an array of package
        // *name strings* -- against `packages._id`, a list of ObjectIds. Those
        // never match, so `$lookup` returned an empty array and the endpoint
        // reported `packages: []` for every namespace, at HTTP 200. Found by
        // running this against seeded data; no test had asserted the join
        // returned anything, only that the route did not 500.
        //
        // It also had `$unwind` followed by `rows[0]`, which would have capped
        // the response at a single package even with a correct join.
        $lookup: {
          from: "packages",
          localField: "_id",
          foreignField: "namespace",
          as: "packageDocs",
        },
      },
      {
        $project: {
          createdAt: 1,
          // Defect D67: `description` was collected on create, validated, stored --
          // and then never returned, so a namespace description was write-only.
          // The create form asks for one and the namespace page has no way to show
          // it. Additive: an existing client ignores a field it does not read.
          description: 1,
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

  const docs = (row.packageDocs ?? []) as Record<string, unknown>[];

  // Contract: `createdAt` must be a string, because the frontend slices it
  // (`.slice(4,16)`). toJsonSafe converts the BSON Date.
  return jsonOk({
    createdAt: toJsonSafe(row.createdAt),
    // D67. Coerced to a string because the stored value is free text written by a
    // form: `undefined` for the namespaces created before this field existed, and
    // the page must be able to render "no description" rather than crash.
    description: typeof row.description === "string" ? row.description : "",
    packages: docs.map((doc) => ({
      namespace: doc.namespace_name,
      name: doc.name,
      description: doc.description,
      keywords: doc.keywords ?? [],
      updated_at: toJsonSafe(doc.updated_at),
    })),
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
  if (!user.roles.includes("admin")) return jsonForbidden();

  const namespace = (await db<NamespaceDoc | null>(env, {
    kind: "findOne",
    collection: "namespaces",
    filter: { namespace: namespaceName },
  })) as NamespaceDoc | null;

  if (!namespace) return jsonError(404, "Namespace not found");

  const namespaceId = namespace._id;

  // Collect the (package, version) pairs before deleting the documents, so the
  // corresponding R2 objects can be pruned. Doing it after the delete would be
  // too late -- the objects would be unreachable but still stored, counting
  // against the 10 GB free-tier ceiling (defect D78).
  //
  // Defect D88: this was driven by `namespaces.packages[]`, which for legacy
  // documents holds package *name strings* rather than ObjectIds (the same
  // mismatch the packages list above documents). `collectPackageVersions`
  // filtered `{_id: {$in: <strings>}}`, matched nothing, returned [], and no R2
  // object was ever pruned -- every namespace delete leaked its tarballs.
  // The delete below keys on `namespace`, so the collection now does too, and
  // the ids for the user unlink come from those documents rather than from the
  // legacy array.
  const packages = await collectNamespacePackages(env, namespaceId);
  const packageIds = packages.map((p) => p.id);
  const packageVersions = packages.map((p) => ({
    packageName: p.name,
    versions: p.versions,
  }));

  await db(env, {
    kind: "transaction",
    steps: [
      // Remove the packages themselves.
      { kind: "deleteMany", collection: "packages", filter: { namespace: namespaceId } },
      // Unlink from every author and maintainer. `$in` over the *resolved*
      // ObjectIds; the legacy `namespaces.packages[]` entries are cleared by
      // the namespace delete below regardless.
      ...(packageIds.length > 0
        ? [{
            kind: "updateMany" as const,
            collection: "users",
            filter: {},
            update: { $pull: { authorOf: { $in: packageIds }, maintainerOf: { $in: packageIds } } },
          }]
        : []),
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

  // R2 cleanup is scheduled rather than blocking the response.
  ctx.waitUntil(
    (async () => {
      for (const pv of packageVersions) {
        await deletePackageTarballs(env, namespaceName, pv.packageName, pv.versions);
      }
      logger.info("namespace tarballs pruned", { namespace: namespaceName, packages: packageVersions.length });
    })(),
  );

  return jsonOk({ message: "Namespace deleted successfully" });
}

/**
 * Every package in a namespace, by the field the delete actually uses.
 *
 * Defect D78 fixed this to collect what the R2 key derives from instead of
 * legacy GridFS `oid`s. Defect D88 fixed the *join*: it filtered on
 * `namespaces.packages[]`, which holds name strings on legacy documents rather
 * than ObjectIds, so the result was always empty and every namespace delete
 * leaked its tarballs. `packages.namespace` is the same selector the
 * `deleteMany` below uses, so the two cannot disagree again.
 */
async function collectNamespacePackages(
  env: Env,
  namespaceId: unknown,
): Promise<{ id: unknown; name: string; versions: string[] }[]> {
  if (namespaceId === undefined || namespaceId === null) return [];
  const packages = (await db<unknown[]>(env, {
    kind: "find",
    collection: "packages",
    filter: { namespace: namespaceId },
    projection: { name: 1, versions: 1 },
  })) as Record<string, unknown>[];

  return (packages ?? [])
    .map((pkg) => ({
      id: pkg._id,
      name: String(pkg.name ?? ""),
      versions: ((pkg.versions ?? []) as Record<string, unknown>[])
        .map((v) => String(v.version ?? ""))
        .filter((v) => v.length > 0),
    }))
    .filter((p) => p.name.length > 0);
}

// ── helpers ───────────────────────────────────────────────────────────────────

type NamespaceDoc = NamespaceLike & { description?: string; createdAt?: Date };




/** Read either form-encoded or JSON bodies. `POST /namespaces` accepts both. */


export { readBody, findUser, NAMESPACE_NAME_MAX };
// Re-exported so callers have one import site for the permission helpers.
export { isNamespaceAdmin, isNamespaceMaintainer, isNamespaceAuthor, containsId, strId };