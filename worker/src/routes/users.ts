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
import { jsonError, jsonOk } from "../lib/responses";
import { authenticate } from "../lib/auth";
import type { AuthContext } from "../lib/auth";
import {
  canPublishPackage,
  isNamespaceAdmin,
  isNamespaceAuthor,
  isNamespaceMaintainer,
  isPackageMaintainer,
  isSiteAdmin,
  managesOnlySelf,
  strId,
  type NamespaceLike,
  type UserLike,
} from "../lib/permissions";
import { logger } from "../lib/logger";
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
    if (method === "POST" && action === "admin") return isAdmin(env, auth);
    if (method === "POST" && action === "delete") return deleteUser(request, env, auth, ctx);

    if (method === "POST" && action === "admin" && segments[2] === "transfer") {
      // Explicitly refused rather than left to fall through as a 404.
      return jsonError(501, "This Functionality has been disabled.");
    }
    return null;
  }

  // ── /{username}/maintainer | namespace/maintainer | namespace/admin ────────
  if (method === "POST" && segments.length >= 3) {
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
      // The *profile owner's* packages, not the viewer's. This filtered on
      // `viewer?._id`, so it returned the right answer only when you opened your
      // own profile: for any other username, and for an anonymous visitor --
      // which is how a public profile page is normally first loaded -- the filter
      // was `author: undefined` and matched nothing. `packages: []` at HTTP 200.
      //
      // Publishing someone's packages is not sensitive: they are listed on the
      // search results and the package pages already.
      filter: { author: user._id },
      projection: { name: 1, namespace_name: 1 },
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
        { $project: { namespace: 1, description: 1, author: 1, admins: 1, maintainers: 1, packageCount: { $size: "$packageDocs" } } },
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
    packages: ((owned ?? []) as Record<string, unknown>[]).map((p) => ({
      name: p.name,
      namespace: p.namespace_name,
    })),
    namespaces: ((memberships ?? []) as Record<string, unknown>[]).map((n) => ({
      id: strId(n._id),
      name: n.namespace,
      description: n.description,
      isNamespaceAdmin: contains(viewer?._id, n.admins),
      isNamespaceMaintainer: contains(viewer?._id, n.maintainers),
      isAuthor: strId(n.author) === strId(viewer?._id),
      packageCount: n.packageCount,
    })),
  });
}

function contains(list: unknown, id: unknown): boolean {
  if (!Array.isArray(list)) return false;
  const target = strId(id);
  return target !== "" && list.some((e) => strId(e) === target);
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
  if (!isSiteAdmin(user)) return jsonError(401, "Unauthorized");

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
  if (!isSiteAdmin(viewer)) return jsonError(401, "Unauthorized");

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
    projection: { _id: 1 },
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
          $pull: {
            author: target._id,
            admins: target._id,
            maintainers: target._id,
            packages: { $in: ownedIds },
          },
        },
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

  logger.info("user deleted", { username, packagesRemoved: ownedIds.length });
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
    return { ok: false, response: jsonError(401, "Unauthorized") };
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
    return jsonError(401, "Unauthorized");
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: pkg._id, maintainers: { $ne: target._id } },
    update: { $addToSet: { maintainers: target._id } },
  })) as { modifiedCount: number };

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { _id: target._id },
    update: { $addToSet: { maintainerOf: pkg._id } },
  });

  const added = result.modifiedCount > 0;
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
    return jsonError(401, "Unauthorized");
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: pkg._id, maintainers: target._id },
    update: { $pull: { maintainers: target._id } },
  })) as { modifiedCount: number };

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { _id: target._id },
    update: { $pull: { maintainerOf: pkg._id } },
  });

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
    return jsonError(401, "Unauthorized");
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "namespaces",
    filter: { _id: namespace._id, maintainers: { $ne: target._id } },
    update: { $addToSet: { maintainers: target._id } },
  })) as { modifiedCount: number };

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
  if (!isNamespaceAdmin(g.actor, namespace)) return jsonError(401, "Unauthorized");

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
    return jsonError(401, "Unauthorized");
  }

  const target = await findUserByUsername(env, targetUsername);
  if (!target) return jsonError(404, "User not found");

  const result = (await db<{ modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "namespaces",
    filter: { _id: namespace._id, admins: { $ne: target._id } },
    update: { $addToSet: { admins: target._id } },
  })) as { modifiedCount: number };

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
    return jsonError(401, "Unauthorized");
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