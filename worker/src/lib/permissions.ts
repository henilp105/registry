/**
 * Authorisation predicates.
 *
 * Dependency-free on purpose, so they can be unit tested without a Worker
 * runtime, and so every route resolves membership the same way.
 *
 * ── Why these are string comparisons ─────────────────────────────────────────
 * `v2.0.1` compares membership by stringifying both sides:
 *
 *     def checkIsNamespaceAdmin(user_id, namespace):
 *         admins_id_list = [str(obj_id) for obj_id in namespace["admins"]]
 *         return str(user_id) in admins_id_list
 *
 * That is necessary because the stored representation is genuinely
 * inconsistent: some writes store `ObjectId`s and some store hex strings. Note
 * `models/package.py:42` even stringifies package maintainers deliberately
 * while leaving namespace `admins` as ObjectIds.
 *
 * So these helpers are the single point of truth for "is this user allowed",
 * and a mismatch here is a silent authorisation bypass. That is why the
 * mixed-representation cases are pinned by tests.
 */

export type IdLike = unknown;

export type UserLike = {
  _id: IdLike;
  uuid?: string;
  username?: string;
  roles?: string[];
};

export type NamespaceLike = {
  _id?: IdLike;
  namespace: string;
  author?: IdLike;
  admins?: IdLike[];
  maintainers?: IdLike[];
  packages?: IdLike[];
};

export type PackageLike = {
  _id?: IdLike;
  name: string;
  namespace?: IdLike;
  maintainers?: IdLike[];
};

/**
 * Normalise an identifier to a comparable string.
 *
 * Accepts a plain string, a driver ObjectId (via `toHexString`), or anything
 * with a useful `toString`. Never throws.
 */
export function strId(value: IdLike): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return normaliseHex(value);
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const asHex = (value as { toHexString?: () => string }).toHexString;
  if (typeof asHex === "function") return normaliseHex(asHex.call(value));
  return String(value);
}

/**
 * Lowercase a 24-character hex ObjectId.
 *
 * MongoDB always emits lowercase hex, so in practice this is a no-op. But a
 * namespace or user imported from an export that uppercased the ids would fail
 * every membership check — a silent authorisation failure where a legitimate
 * admin suddenly has no rights. Normalising is free insurance.
 *
 * Deliberately restricted to exactly 24 hex characters so a username that
 * happens to contain hex characters is never lowercased.
 */
function normaliseHex(value: string): string {
  return value.length === 24 && /^[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : value;
}

/** True when `list` contains `id`, comparing normalised forms. */
export function containsId(list: IdLike[] | undefined, id: IdLike): boolean {
  if (!Array.isArray(list)) return false;
  const target = strId(id);
  if (target === "") return false;
  return list.some((entry) => strId(entry) === target);
}

export function isSiteAdmin(user: UserLike): boolean {
  return Array.isArray(user.roles) && user.roles.includes("admin");
}

export function isNamespaceAuthor(user: UserLike, namespace: NamespaceLike): boolean {
  return containsId([namespace.author], user._id);
}

export function isNamespaceAdmin(user: UserLike, namespace: NamespaceLike): boolean {
  return containsId(namespace.admins, user._id);
}

export function isNamespaceMaintainer(user: UserLike, namespace: NamespaceLike): boolean {
  return containsId(namespace.maintainers, user._id);
}

export function isPackageMaintainer(user: UserLike, pkg: PackageLike): boolean {
  return containsId(pkg.maintainers, user._id);
}

/**
 * May `user` publish a new package into `namespace`?
 *
 * Mirrors `checkUserUnauthorizedForNamespaceTokenCreation` on `v2.0.1`: site
 * admin, namespace admin, or namespace maintainer. Package maintainers are
 * deliberately excluded — they may publish *existing* packages they maintain,
 * not create new ones in the namespace.
 */
export function canCreatePackageIn(user: UserLike, namespace: NamespaceLike): boolean {
  return (
    isSiteAdmin(user) || isNamespaceAdmin(user, namespace) || isNamespaceMaintainer(user, namespace)
  );
}

/**
 * May `user` publish a new version of `pkg`?
 *
 * Mirrors `checkUserUnauthorized` on `v2.0.1`: the union of site admin,
 * namespace admin, namespace maintainer, and package maintainer.
 */
export function canPublishPackage(
  user: UserLike,
  namespace: NamespaceLike,
  pkg: PackageLike,
): boolean {
  return (
    isSiteAdmin(user) ||
    isNamespaceAdmin(user, namespace) ||
    isNamespaceMaintainer(user, namespace) ||
    isPackageMaintainer(user, pkg)
  );
}

/**
 * May `user` manage someone else's membership? Always no.
 *
 * `v2.0.1` additionally requires `user["username"] == username` on all six
 * `/{username}/…` maintainer routes — even for a site admin. That means an
 * admin cannot use those endpoints to fix another account, which is almost
 * certainly unintended, but it *is* the current behaviour, so it is preserved
 * here and flagged rather than silently changed.
 */
export function managesOnlySelf(authenticatedUsername: string, pathUsername: string): boolean {
  return authenticatedUsername === pathUsername;
}
/**
 * A validated upload token, reduced to what an authorisation check needs.
 *
 * Kept here rather than in `upload-tokens.ts` so it stays free of the
 * database import chain and can be unit tested without a Worker runtime.
 */
export type UploadTokenVerdict = {
  namespaceId: string;
  /** `null` for a namespace-scoped token. */
  packageId: string | null;
  createdBy: string;
};

/**
 * Is this token allowed to publish into `namespaceId` / `packageId`?
 *
 * The scope check is deliberately separate from token *validation*
 * (`consumeUploadToken`), so a token can be validated once and then tested
 * against several candidate targets without burning another use.
 *
 * A package-scoped token may publish only that package. A namespace-scoped
 * token may publish anything inside the namespace.
 *
 * `v2.0.1` had no scoping at all: every namespace token could publish
 * anywhere in that namespace, and package tokens could not publish anything
 * (defect D4).
 */
export function tokenAllows(
  verdict: UploadTokenVerdict,
  namespaceId: string,
  packageId?: string | null,
): boolean {
  if (verdict.namespaceId !== namespaceId) return false;
  if (verdict.packageId) return verdict.packageId === (packageId ?? null);
  return true;
}
