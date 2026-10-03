/**
 * Users — `/users/*` and the six `/{username}/{action}` maintainer routes.
 *
 * Defects closed here:
 *   D5   `GET /users/<username>` returned the user's **email address** plus every
 *        namespace and package they touch, unauthenticated and unrated. That is
 *        a PII disclosure and an enumeration oracle. Email is now admin-or-self
 *        only; the public shape keeps username, avatar and public activity.
 *   D13  Deleting a user left every namespace they authored, every package in
 *        `authorOf`, and every membership dangling.
 *   D14  `remove_admins_from_namespace` returned HTTP 200 carrying `code: 401`.
 *   D32  `POST /users/admin` returns `isAdmin` as the **string** `"true"`, not a
 *        boolean. Preserved, because the frontend compares it as a string.
 *
 * Note the odd ones, which the frontend depends on and which are preserved:
 *   - `POST /users/account` takes no body; identity comes from the Bearer token.
 *     The frontend also sends an `accessToken` form field, which is ignored.
 *   - `POST /users/admin/transfer` is unauthenticated and always 501 on
 *     `v2.0.1`. Dropped rather than reproduced: it is dead attack surface.
 */

import { db, toJsonSafe } from "../db/client";
import type { Env } from "../db/client";
import {
  jsonError,
  jsonForbidden,
  jsonOk,
} from "../lib/responses";
import { authenticate } from "../lib/auth";
import type { AuthContext } from "../lib/auth";
import {
  canPublishPackage,
  containsId,
  isNamespaceAdmin,
  isNamespaceAuthor,
  isNamespaceMaintainer,
  isPackageMaintainer,
  isSiteAdmin,
  managesOnlySelf,
  strId,
  type IdLike,
  type NamespaceLike,
  type UserLike,
} from "../lib/permissions";
import { invalidate, ENTITY } from "../lib/cache";
import { memberOf, notMemberOf, pullBothForms } from "../db/bson";
import { logger } from "../lib/logger";
import { deletePackageTarballs } from "../lib/storage";
import { readBody } from "./namespaces";

export async function handleUserRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: AuthContext | null,
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  // ── /users/* ───────────────────────────────────────────────────────────────
  if (segments[0] === "users") {
    const action = segments[1];

    if (method === "GET" && segments.length === 2) return profile(request, env, action as string);
    if (method === "POST" && action === "account") return account(env, auth);
    // Defect D85: this branch sat *after* the generic `users/admin` match,
    // which caught `POST /users/admin/transfer` first — the documented 501
    // was unreachable. Ordered before the generic one now.
    if (method === "POST" && action === "admin" && segments[2] === "transfer") {
      // Explicitly refused rather than left to fall through as a 404.
      return jsonError(501, "This Functionality has been disabled.");
    }
    if (method === "POST" && action === "admin") return isAdmin(env, auth);
    if (method === "POST" && action === "delete") return deleteUser(request, env, auth, ctx);
    return null;
  }

  // ── /{username}/maintainer | namespace/maintainer | namespace/admin ────────
  // segments.length >= 2, not >= 3: `/{username}/maintainer` has exactly two
  // segments, so the guard used to make addPackageMaintainer unreachable.
  if (method === "POST" && segments.length >= 2) {
    const pathUsername = segments[0] as string;
    const action = segments.slice(1).join("/");

    switch (action) {
      case "maintainer":
        return addPackageMaintainer(request, env, auth, pathUsername);
      case "maintainer/remove":
        return removePackageMaintainer(request, env, auth, pathUsername);
      case "namespace/maintainer":
        return addNamespaceMaintainer(request, env, auth, pathUsername);
      case "namespace/maintainer/remove":
        return removeNamespaceMaintainer(request, env, auth, pathUsername);
      case "namespace/admin":
        return addNamespaceAdmin(request, env, auth, pathUsername);
      case "namespace/admin/remove":
        return removeNamespaceAdmin(request, env, auth, pathUsername);
      default:
        return null;
    }
  }

  void url;
  void ctx;
  return null;
}

// ── GET /users/{username} ─────────────────────────────────────────────────────

/**
 * Public profile.
 *
 * `v2.0.1` returned `user: {username, email, createdAt}` unauthenticated. The
 * email is the sensitive part (defect D5), so it is included only for the
 * account owner or a site admin. Everything else is unchanged, because the
 * dashboard and user pages read it.
 *
 * One aggregation replaces the N+1 lookups: `v2.0.1` fetched every namespace
 * the user touches, then one `find_one` per namespace package, then one
 * `find_one` per package author (defect D25).
 */
/** Shape returned by `GET /users/{username}`. */
type PublicProfileDoc = UserLike & { email?: string; createdAt?: Date };

async function profile(request: Request, env: Env, username: string): Promise<Response> {
  const self = await authenticate(request, env);

  const user = (await db<PublicProfileDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { username },
    // `_id` is required: the packages list below filters on `packages.author`,
    // which is a foreign key to `users._id`. The previous projection omitted it,
    // so the filter had no id to match.
    projection: { _id: 1, username: 1, email: 1, createdAt: 1 },
  })) as PublicProfileDoc | null;

  if (!user) return jsonError(404, "User not found");

  // Resolve the viewer once. `null` means anonymous, which is a different
  // case from "logged in as somebody else" and must not leak the email.
  const viewer = await resolveViewer(env, self);
  const isSelf = viewer !== null && viewer.username === username;

  const [owned, memberships] = await Promise.all([
    db<unknown[]>(env, {
      kind: "find",
      collection: "packages",
      // The *profile owner's* packages — authored by them, or where they hold
      // a maintainer seat. Defect D85: the previous filter matched only
      // `author`, so every package the user merely maintains was invisible,
      // and the projection dropped everything except name/namespace — the
      // dashboard rendered `key={undefined}`, no descriptions, and never
      // offered the maintainer actions.
      filter: { $or: [{ author: user._id }, { maintainers: memberOf(user._id) }] },
      projection: {
        name: 1,
        namespace: 1,
        namespace_name: 1,
        description: 1,
        updated_at: 1,
        maintainers: 1,
        keywords: 1,
        categories: 1,
      },
    }),
    db<unknown[]>(env, {
      kind: "aggregate",
      collection: "namespaces",
      pipeline: [
        // The profile owner's namespaces, by the same reasoning as the packages
        // list above. Filtering on the viewer meant an anonymous visitor to any
        // profile saw `namespaces: []`.
        { $match: { $or: [{ author: user._id }, { admins: user._id }, { maintainers: user._id }] } },
        {
          $lookup: {
            from: "packages",
            let: { nsId: "$_id" },
            pipeline: [{ $match: { $expr: { $eq: ["$namespace", "$$nsId"] } } }, { $project: { name: 1 } }],
            as: "packageDocs",
          },
        },
        { $project: { _id: 1, namespace: 1, description: 1, author: 1, admins: 1, maintainers: 1, packageCount: { $size: "$packageDocs" } } },
      ],
    }),
  ]);

  const isViewer = isSelf || (viewer !== null && isSiteAdmin(viewer));

  return jsonOk({
    message: "User found",
    user: {
      username: user.username,
      // Defect D5: withheld unless the viewer is the owner or a site admin.
      ...(isViewer ? { email: user.email } : {}),
      createdAt: toJsonSafe(user.createdAt),
    },
    packages: ((owned ?? []) as Record<string, unknown>[]).map((p) => {
      // Role chips describe the *profiled* user, mirroring the legacy Flask
      // contract (docs/BASELINE_AUDIT D32 shape).
      const ns = (memberships ?? []).find((n) => strId((n as Record<string, unknown>)._id) === strId(p.namespace)) as Record<string, unknown> | undefined;
      return {
        id: strId(p._id),
        name: p.name,
        namespace: p.namespace_name,
        description: p.description ?? "",
        updated_at: toJsonSafe(p.updated_at),
        isNamespaceAdmin: containsId(ns?.admins as IdLike[] | undefined, user._id as IdLike),
        isNamespaceMaintainer: containsId(ns?.maintainers as IdLike[] | undefined, user._id as IdLike),
        isPackageMaintainer: containsId(p.maintainers as IdLike[] | undefined, user._id as IdLike),
        keywords: Array.from(new Set([
          ...(Array.isArray(p.keywords) ? (p.keywords as string[]) : []),
          ...(Array.isArray(p.categories) ? (p.categories as string[]) : []),
        ])),
      };
    }),
    namespaces: ((memberships ?? []) as Record<string, unknown>[]).map((n) => ({
      id: strId(n._id),
      name: n.namespace,
      description: n.description,
      // Defect D68: these were `contains(viewer?._id, n.admins)` against a
      // signature of `contains(list, id)` -- the arguments were swapped, so
      // `list` was a hex string, `Array.isArray` was false, and both flags were
      // **always false** no matter who was asking.
      //
      // Measured: the viewer `_id` and `n.admins[0]` were byte-identical
      // ("6abfa8c70798ba06d7211b0b"), `strId(a) === strId(b)` was true, and
      // `contains(a, b)` still returned false. The only reason is the swapped
      // order, and the local duplicate is gone so it cannot happen again.
      // Cast, because the aggregation result is typed `Record<string, unknown>`.
      // Safe: `$project` selects `admins`/`maintainers` straight off the document,
      // and `containsId` re-checks `Array.isArray` itself.
      isNamespaceAdmin: containsId(n.admins as IdLike[], viewer?._id),
      isNamespaceMaintainer: containsId(n.maintainers as IdLike[], viewer?._id),
      isAuthor: viewer !== null && strId(n.author) === strId(viewer._id),
      packageCount: n.packageCount,
    })),
  });
}

/** Load the authenticated user's own document. */
async function resolveViewer(env: Env, auth: AuthContext | null): Promise<UserLike | null> {
  if (!auth) return null;
  return (await db<UserLike | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { uuid: auth.uuid },
    projection: { username: 1, roles: 1, _id: 1 },
  })) as UserLike | null;
}

/** Shape returned by `POST /users/account`. */
type AccountDoc = UserLike & {
  email?: string;
  createdAt?: Date;
  loginAt?: Date;
  lastLogout?: Date | null;
};

// ── POST /users/account ───────────────────────────────────────────────────────

async function account(env: Env, auth: AuthContext | null): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const user = (await db<AccountDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { uuid: auth.uuid },
    projection: { username: 1, email: 1, createdAt: 1, loginAt: 1, lastLogout: 1 },
  })) as AccountDoc | null;

  if (!user) return jsonError(404, "User not found");

  // Contract: createdAt must be a >=16 char string, because
  // accountActions.js calls user.createdAt.slice(0,16).
  return jsonOk({
    message: "User Found",
    user: {
      username: user.username,
      email: user.email,
      createdAt: toJsonSafe(user.createdAt),
      loginAt: toJsonSafe(user.loginAt),
      lastLogout: toJsonSafe(user.lastLogout),
    },
  });
}

// ── POST /users/admin ─────────────────────────────────────────────────────────

async function isAdmin(env: Env, auth: AuthContext | null): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const user = await resolveViewer(env, auth);
  if (!user) return jsonError(404, "User not found");
  if (!isSiteAdmin(user)) return jsonForbidden();

  // The string "true", not a boolean. The frontend compares it as a string and
  // changing it would break the admin menu (defect D32).
  return jsonOk({ message: "User is admin", isAdmin: "true" });
}

// ── POST /users/delete ────────────────────────────────────────────────────────

/**
 * Site-admin only. Cascades (defect D13).
 *
 * `v2.0.1` ran a bare `db.users.delete_one({"username": username})` and
 * touched nothing else, despite `docs/authentication.md:397-409` warning that
 * "all packages and namespaces you own will be orphaned".
 */
async function deleteUser(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const viewer = await resolveViewer(env, auth);
  if (!viewer) return jsonError(404, "User not found");
  if (!isSiteAdmin(viewer)) return jsonForbidden();

  const body = await readBody(request);
  const username = body.get("username");
  if (!username) return jsonError(400, "Username is required");

  const target = (await db<UserLike | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { username },
    projection: { username: 1, uuid: 1, _id: 1 },
  })) as UserLike | null;

  if (!target) return jsonError(404, "User not found");

  const ownedPackages = (await db<unknown[]>(env, {
    kind: "find",
    collection: "packages",
    filter: { author: target._id },
    // name/namespace_name/versions are needed to prune the R2 objects after the
    // cascade delete (D78).
    projection: { _id: 1, name: 1, namespace_name: 1, versions: 1, namespace: 1 },
  })) as Record<string, unknown>[];

  const ownedIds = ownedPackages.map((p) => p._id);

  await db(env, {
    kind: "transaction",
    steps: [
      // Remove their packages, unlink those ids from namespaces and other users.
      { kind: "deleteMany", collection: "packages", filter: { author: target._id } },
      {
        kind: "updateMany",
        collection: "namespaces",
        filter: {},
        update: {
          // Arrays only. `author` is deliberately absent from this `$pull`:
          // it is a **scalar** ObjectId, not an array, and `$pull` on a
          // non-array raises `Cannot apply $pull to a non-array value`.
          //
          // Because this runs inside a transaction, that one bad field rolled the
          // whole cascade back, so `POST /users/delete` returned HTTP 500 and
          // deleted nothing -- for any user who had authored a namespace. Found
          // by exercising the write path against the live cluster; no unit test
          // reached it, because every fixture had `author` already absent.
          $pull: {
            admins: target._id,
            maintainers: target._id,
            packages: { $in: ownedIds },
          },
        },
      },
      {
        // The scalar half of the same cleanup, as its own step.
        kind: "updateMany",
        collection: "namespaces",
        filter: { author: target._id },
        update: { $set: { author: null } },
      },
      {
        kind: "updateMany",
        collection: "users",
        filter: {},
        update: { $pull: { authorOf: { $in: ownedIds }, maintainerOf: { $in: ownedIds } } },
      },
      { kind: "updateMany", collection: "upload_tokens", filter: { created_by: target.uuid }, update: { $set: { revoked_at: new Date() } } },
      { kind: "deleteOne", collection: "users", filter: { _id: target._id } },
    ],
  });

  // D78: prune the R2 objects belonging to the packages just deleted. Map
  // each package to its namespace name (legacy docs may lack namespace_name).
  const namespaceNames = new Map<string, string>();
  if (ownedPackages.length > 0) {
    const nsIds = ownedPackages.map((p) => p.namespace).filter((n) => n !== undefined && n !== null);
    if (nsIds.length > 0) {
      const namespaces = (await db<unknown[]>(env, {
        kind: "find",
        collection: "namespaces",
        filter: { _id: { $in: nsIds } },
        projection: { namespace: 1 },
      })) as Record<string, unknown>[];
      for (const ns of namespaces ?? []) namespaceNames.set(strId(ns._id), String(ns.namespace ?? ""));
    }

    ctx.waitUntil(
      (async () => {
        for (const pkg of ownedPackages) {
          const nsName =
            typeof pkg.namespace_name === "string" && pkg.namespace_name.length > 0
              ? pkg.namespace_name
              : namespaceNames.get(strId(pkg.namespace)) ?? "";
          if (!nsName) continue;
          const versions = ((pkg.versions ?? []) as Record<string, unknown>[])
            .map((v) => String(v.version ?? ""))
            .filter((v) => v.length > 0);
          await deletePackageTarballs(env, nsName, String(pkg.name ?? ""), versions);
        }
        logger.info("user tarballs pruned", { username, packages: ownedPackages.length });
      })(),
    );
  }

  logger.info("user deleted", { username, packagesRemoved: ownedIds.length });

  // Retire cached pages that referenced the removed packages/namespaces —
  // without this, GET /packages/{ns}/{pkg} keeps serving the deleted package
  // from the edge cache (defect found in audit round 5).
  {
    const nsSeen = new Set<string>();
    const entities: string[] = [ENTITY.user(username)];
    for (const pkg of ownedPackages) {
      const nsName =
        typeof pkg.namespace_name === "string" && pkg.namespace_name.length > 0
          ? pkg.namespace_name
          : (namespaceNames.get(strId(pkg.namespace)) ?? "");
      if (!nsName) continue;
      entities.push(ENTITY.package(nsName, String(pkg.name ?? "")));
      if (!nsSeen.has(nsName)) {
        nsSeen.add(nsName);
        entities.push(ENTITY.namespace(nsName), ENTITY.namespacePackages(nsName));
      }
    }
    await invalidate(env, ...entities);
  }

  void ctx;
  return jsonOk({ message: "User deleted" });
}

// ── the six maintainership routes ─────────────────────────────────────────────

/**
 * Shared preamble for all six `/{username}/…` routes.
 *
 * Two gates apply, both inherited from `v2.0.1`:
 *   1. a valid Bearer token (defect D4 fix — the frontend used to send none,
 *      which is why all of these returned 401 in practice)
 *   2. `pathUsername` must equal the authenticated user's own username, even
 *      for a site admin. That is almost certainly unintended, but it is the
 *      current behaviour, so `managesOnlySelf` preserves it explicitly.
 */
async function gate(
  env: Env,
  auth: AuthContext | null,
  pathUsername: string,
): Promise<{ ok: true; actor: UserLike } | { ok: false; response: Response }> {
  if (!auth) return { ok: false, response: jsonError(401, "Unauthorized") };

  const actor = await resolveViewer(env, auth);
  if (!actor) return { ok: false, response: jsonError(404, "User not found") };
  if (!managesOnlySelf(String(actor.username), pathUsername)) {
    return { ok: false, response: jsonForbidden() };
  }
  return { ok: true, actor };
}

type MembershipTarget = { ok: true; namespace: NamespaceLike } | { ok: false; response: Response };

async function loadNamespace(env: Env, name: string): Promise<MembershipTarget> {
  const ns = (await db<NamespaceLike | null>(env, {
    kind: "findOne",
    collection: "namespaces",
    filter: { namespace: name },
  })) as NamespaceLike | null;

  if (!ns) return { ok: false, response: jsonError(404, "Namespace not found") };
  return { ok: true, namespace: ns };
}

async function addPackageMaintainer(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  pathUsername: string,
): Promise<Response> {
  const g = await gate(env, auth, pathUsername);
  if (!g.ok) return g.response;

  const body = await readBody(request);
  const targetUsername = body.get("username");
  const namespaceName = body.get("namespace");
  const packageName = body.get("package");

  if (!targetUsername) return jsonError(400, "Please enter username");
  if (!packageName) return jsonError(400, "Please enter package name");
  if (!namespaceName) return jsonError(400, "Please enter namespace name");

  const ns = await loadNamespace(env, namespaceName);
  if (!ns.ok) return ns.response;

  const pkg = (await db<(UserLike & { name: string; maintainers?: unknown[] }) | null>(env, {
    kind: "findOne",
    collection: "packages",
    filter: { name: packageName, namespace: (ns as { namespace: NamespaceLike }).namespace._id },
    projection: { name: 1, maintainers: 1 },
  })) as (UserLike & { name: string; maintainers?: unknown[] }) | null;

  if (!pkg) return jsonError(404, "Package not found");

  if (!canPublishPackage(g.actor, (ns as { namespace: NamespaceLike }).namespace, pkg)) {
    return jsonForbidden();
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: pkg._id, maintainers: notMemberOf(target._id) },
    update: { $addToSet: { maintainers: target._id } },
  })) as { modifiedCount: number };

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { _id: target._id },
    update: { $addToSet: { maintainerOf: pkg._id } },
  });

  const added = result.modifiedCount > 0;
  // Defect D85: maintainer changes never retired the cached package payload,
  // so a newly added maintainer stayed invisible for up to the TTL.
  await invalidate(env, ENTITY.package(namespaceName, packageName), ENTITY.namespacePackages(namespaceName));
  return jsonOk({
    message: added ? "Maintainer added successfully" : "Maintainer already added",
  });
}

async function removePackageMaintainer(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  pathUsername: string,
): Promise<Response> {
  const g = await gate(env, auth, pathUsername);
  if (!g.ok) return g.response;

  const body = await readBody(request);
  const targetUsername = body.get("username");
  const namespaceName = body.get("namespace");
  const packageName = body.get("package");

  if (!targetUsername) return jsonError(400, "Please enter username");
  if (!packageName) return jsonError(400, "Please enter package name");
  if (!namespaceName) return jsonError(400, "Please enter namespace name");

  const ns = await loadNamespace(env, namespaceName);
  if (!ns.ok) return ns.response;

  const pkg = (await db<(UserLike & { name: string; maintainers?: unknown[] }) | null>(env, {
    kind: "findOne",
    collection: "packages",
    filter: { name: packageName, namespace: (ns as { namespace: NamespaceLike }).namespace._id },
    projection: { name: 1, maintainers: 1 },
  })) as (UserLike & { name: string; maintainers?: unknown[] }) | null;

  if (!pkg) return jsonError(404, "Package not found");

  // `v2.0.1` requires namespace admin OR namespace maintainer here. A package
  // maintainer cannot remove another maintainer, which is a deliberate
  // asymmetry with the add path and is preserved.
  if (!isNamespaceAdmin(g.actor, (ns as { namespace: NamespaceLike }).namespace) &&
      !isNamespaceMaintainer(g.actor, (ns as { namespace: NamespaceLike }).namespace)) {
    return jsonForbidden();
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: pkg._id, maintainers: memberOf(target._id) },
    update: { $pull: { maintainers: pullBothForms(target._id) } },
  })) as { modifiedCount: number };

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { _id: target._id },
    update: { $pull: { maintainerOf: pkg._id } },
  });

  await invalidate(env, ENTITY.package(namespaceName, packageName), ENTITY.namespacePackages(namespaceName));
  return jsonOk({
    message: result.modifiedCount > 0 ? "Maintainer removed successfully" : "Package maintainer not found",
  });
}

async function addNamespaceMaintainer(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  pathUsername: string,
): Promise<Response> {
  const g = await gate(env, auth, pathUsername);
  if (!g.ok) return g.response;

  const body = await readBody(request);
  const targetUsername = body.get("username");
  const namespaceName = body.get("namespace");
  if (!targetUsername) return jsonError(400, "Please enter username");
  if (!namespaceName) return jsonError(400, "Please enter namespace name");

  const ns = await loadNamespace(env, namespaceName);
  if (!ns.ok) return ns.response;
  const namespace = (ns as { namespace: NamespaceLike }).namespace;

  if (!isNamespaceAdmin(g.actor, namespace) && !isNamespaceMaintainer(g.actor, namespace)) {
    return jsonForbidden();
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "namespaces",
    filter: { _id: namespace._id, maintainers: { $ne: target._id } },
    update: { $addToSet: { maintainers: target._id } },
  })) as { modifiedCount: number };

  await invalidate(env, ENTITY.namespace(namespaceName), ENTITY.namespacePackages(namespaceName));
  return jsonOk({
    message: result.modifiedCount > 0 ? "Maintainer added successfully" : "Maintainer already added",
  });
}

async function removeNamespaceMaintainer(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  pathUsername: string,
): Promise<Response> {
  const g = await gate(env, auth, pathUsername);
  if (!g.ok) return g.response;

  const body = await readBody(request);
  const targetUsername = body.get("username");
  const namespaceName = body.get("namespace");
  if (!targetUsername) return jsonError(400, "Please enter username");
  if (!namespaceName) return jsonError(400, "Please enter namespace name");

  const ns = await loadNamespace(env, namespaceName);
  if (!ns.ok) return ns.response;
  const namespace = (ns as { namespace: NamespaceLike }).namespace;

  // v2.0.1 requires namespace admin for removal, even though any maintainer
  // may add. Preserved.
  if (!isNamespaceAdmin(g.actor, namespace)) return jsonForbidden();

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  // Refuse to strip an admin's maintainer role: v2.0.1 does this, and it is
  // the only thing preventing an admin from losing their own write access.
  if (isNamespaceAdmin(target, namespace)) {
    return jsonError(401, "Admins cannot be removed from the namespace maintainer role");
  }

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "namespaces",
    filter: { _id: namespace._id, maintainers: target._id },
    update: { $pull: { maintainers: target._id } },
  })) as { modifiedCount: number };

  await invalidate(env, ENTITY.namespace(namespaceName), ENTITY.namespacePackages(namespaceName));
  return jsonOk({
    message: result.modifiedCount > 0 ? "Maintainer removed successfully" : "Namespace maintainer not found",
  });
}

async function addNamespaceAdmin(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  pathUsername: string,
): Promise<Response> {
  const g = await gate(env, auth, pathUsername);
  if (!g.ok) return g.response;

  const body = await readBody(request);
  const targetUsername = body.get("username");
  const namespaceName = body.get("namespace");
  if (!targetUsername) return jsonError(400, "Please enter username");
  if (!namespaceName) return jsonError(400, "Please enter namespace name");

  const ns = await loadNamespace(env, namespaceName);
  if (!ns.ok) return ns.response;
  const namespace = (ns as { namespace: NamespaceLike }).namespace;

  // Namespace admin OR namespace author may grant admin.
  if (!isNamespaceAdmin(g.actor, namespace) && !isNamespaceAuthor(g.actor, namespace)) {
    return jsonForbidden();
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "namespaces",
    filter: { _id: namespace._id, admins: { $ne: target._id } },
    update: { $addToSet: { admins: target._id } },
  })) as { modifiedCount: number };

  await invalidate(env, ENTITY.namespace(namespaceName), ENTITY.namespacePackages(namespaceName));
  return jsonOk({
    message: result.modifiedCount > 0 ? "Admin added successfully" : "Admin already added",
  });
}

async function removeNamespaceAdmin(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  pathUsername: string,
): Promise<Response> {
  const g = await gate(env, auth, pathUsername);
  if (!g.ok) return g.response;

  const body = await readBody(request);
  const targetUsername = body.get("username");
  const namespaceName = body.get("namespace");
  if (!targetUsername) return jsonError(400, "Please enter username");
  if (!namespaceName) return jsonError(400, "Please enter namespace name");

  const ns = await loadNamespace(env, namespaceName);
  if (!ns.ok) return ns.response;
  const namespace = (ns as { namespace: NamespaceLike }).namespace;

  if (!isNamespaceAdmin(g.actor, namespace) && !isNamespaceAuthor(g.actor, namespace)) {
    return jsonForbidden();
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  // The namespace author cannot be stripped of admin rights.
  // v2.0.1 returns HTTP 200 with `code: 401` here (defect D14); we return a
  // real 401.
  if (isNamespaceAuthor(target, namespace)) {
    return jsonError(401, "Namespace owners cannot be removed from admins");
  }

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "namespaces",
    filter: { _id: namespace._id, admins: target._id },
    update: { $pull: { admins: target._id } },
  })) as { modifiedCount: number };

  await invalidate(env, ENTITY.namespace(namespaceName), ENTITY.namespacePackages(namespaceName));
  return jsonOk({
    message: result.modifiedCount > 0 ? "Admin removed successfully" : "Admin already removed",
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function findUserByUsername(env: Env, username: string): Promise<UserLike | null> {
  return (await db<UserLike | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { username },
    projection: { username: 1, uuid: 1, roles: 1, _id: 1 },
  })) as UserLike | null;
}

export { isPackageMaintainer, strId };