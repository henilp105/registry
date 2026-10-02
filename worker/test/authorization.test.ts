import { describe, expect, it } from "vitest";
import {
  isNamespaceAdmin,
  isNamespaceAuthor,
  isNamespaceMaintainer,
  isPackageMaintainer,
  isSiteAdmin,
  canCreatePackageIn,
  canPublishPackage,
  containsId,
  managesOnlySelf,
  strId,
  tokenAllows,
  type UploadTokenVerdict,
} from "../src/lib/permissions";

/**
 * `v2.0.1` compares membership by stringifying both sides, because some writes
 * store ObjectIds and some store hex strings:
 *
 *     def checkIsNamespaceAdmin(user_id, namespace):
 *         admins_id_list = [str(obj_id) for obj_id in namespace["admins"]]
 *         return str(user_id) in admins_id_list
 *
 * That comparison is the single point of failure for every authorisation check
 * in the app. These tests pin the mixed-representation cases, because that is
 * where a silent bypass would come from.
 */

const HEX = "6abf30765c28fa0d62360ef6";

/** Distinct ids used by the role-matrix tests. */
const NS_ADMIN_ID = "aaaaaaaaaaaaaaaaaaaaaa01";
const NS_MAINT_ID = "bbbbbbbbbbbbbbbbbbbbbb02";
const NS_AUTHOR_ID = "cccccccccccccccccccc03";
const PKG_MAINT_ID = "dddddddddddddddddddddd04";

/** Stand-in for a driver ObjectId: only toHexString() and toString() exist. */
class FakeObjectId {
  constructor(private readonly hex: string) {}
  toHexString(): string {
    return this.hex;
  }
  toString(): string {
    return this.hex;
  }
}

const asObjectId = () => new FakeObjectId(HEX);

describe("strId", () => {
  it("passes a hex string through unchanged", () => {
    expect(strId(HEX)).toBe(HEX);
  });

  it("unwraps an ObjectId via toHexString", () => {
    expect(strId(asObjectId())).toBe(HEX);
  });

  it("falls back to toString for other object-like values", () => {
    expect(strId({ toString: () => HEX })).toBe(HEX);
  });

  it("returns empty for null and undefined rather than throwing", () => {
    expect(strId(null)).toBe("");
    expect(strId(undefined)).toBe("");
  });
});

describe("containsId", () => {
  it("matches a hex string against a hex string", () => {
    expect(containsId([HEX], HEX)).toBe(true);
  });

  it("matches a hex string against an ObjectId", () => {
    expect(containsId([HEX], asObjectId())).toBe(true);
  });

  it("matches an ObjectId against a hex string", () => {
    expect(containsId([asObjectId()], HEX)).toBe(true);
  });

  it("matches an ObjectId against an ObjectId", () => {
    expect(containsId([asObjectId()], asObjectId())).toBe(true);
  });

  it("rejects a different id", () => {
    expect(containsId(["aaaaaaaaaaaaaaaaaaaaaaaa"], HEX)).toBe(false);
  });

  it("normalises hex case, so an imported uppercase id still matches", () => {
    // MongoDB always emits lowercase hex, so this only matters for data
    // imported from an export that uppercased the ids. Without normalisation
    // that silently strips every membership right from a legitimate admin.
    expect(containsId([HEX.toUpperCase()], HEX)).toBe(true);
    expect(containsId([HEX], HEX.toUpperCase())).toBe(true);
  });

  it("does not lowercase a non-hex string that happens to be 24 chars", () => {
    // A username is not an ObjectId and must not be case-folded.
    const name = "ABCDEFGHIJKLMNOPQRSTUVWX";
    expect(strId(name)).toBe(name);
  });

  it("returns false for a missing list rather than throwing", () => {
    expect(containsId(undefined, HEX)).toBe(false);
    expect(containsId([], HEX)).toBe(false);
  });
});

describe("namespace role checks", () => {
  const user = { _id: asObjectId(), uuid: "u1", username: "alice", roles: ["user"] };

  it("recognises an admin", () => {
    const ns = { _id: "n1", namespace: "std", admins: [asObjectId()], maintainers: [], author: asObjectId() };
    expect(isNamespaceAdmin(user, ns)).toBe(true);
  });

  it("does not treat a maintainer as an admin", () => {
    const ns = { _id: "n1", namespace: "std", admins: [], maintainers: [asObjectId()], author: "someone-else" };
    expect(isNamespaceAdmin(user, ns)).toBe(false);
    expect(isNamespaceMaintainer(user, ns)).toBe(true);
  });

  it("recognises the author", () => {
    const ns = { _id: "n1", namespace: "std", admins: [], maintainers: [], author: asObjectId() };
    expect(isNamespaceAuthor(user, ns)).toBe(true);
  });

  it("is false for a user with no membership anywhere", () => {
    const ns = { _id: "n1", namespace: "std", admins: [], maintainers: [], author: "someone-else" };
    expect(isNamespaceAdmin(user, ns)).toBe(false);
    expect(isNamespaceMaintainer(user, ns)).toBe(false);
    expect(isNamespaceAuthor(user, ns)).toBe(false);
  });

  it("finds a member among several ids", () => {
    const ns = {
      _id: "n1",
      namespace: "std",
      admins: ["aaaaaaaaaaaaaaaaaaaaaaaa", asObjectId()],
      maintainers: [],
      author: "someone-else",
    };
    expect(isNamespaceAdmin(user, ns)).toBe(true);
  });

  it("recognises a site admin from the roles array", () => {
    expect(isSiteAdmin({ _id: "x", roles: ["admin"] })).toBe(true);
    expect(isSiteAdmin({ _id: "x", roles: ["user"] })).toBe(false);
    expect(isSiteAdmin({ _id: "x" })).toBe(false);
  });

  it("recognises a package maintainer", () => {
    expect(isPackageMaintainer(user, { name: "p", maintainers: [asObjectId()] })).toBe(true);
    expect(isPackageMaintainer(user, { name: "p", maintainers: [] })).toBe(false);
  });
});

describe("canCreatePackageIn", () => {
  const ns = { namespace: "std", admins: [NS_ADMIN_ID], maintainers: [NS_MAINT_ID], author: NS_AUTHOR_ID };

  it("allows a namespace admin", () => {
    expect(canCreatePackageIn({ _id: NS_ADMIN_ID }, ns)).toBe(true);
  });

  it("allows a namespace maintainer", () => {
    expect(canCreatePackageIn({ _id: NS_MAINT_ID }, ns)).toBe(true);
  });

  it("allows a site admin who is in neither list", () => {
    expect(canCreatePackageIn({ _id: "stranger", roles: ["admin"] }, ns)).toBe(true);
  });

  it("denies the namespace author when they hold no admin or maintainer role", () => {
    // v2.0.1 seeds the creator into all three lists on creation, so in practice
    // this cannot happen. Asserted explicitly because the distinction between
    // "author" and "admin" is exactly where a future refactor could open a hole.
    expect(canCreatePackageIn({ _id: NS_AUTHOR_ID }, { ...ns, admins: [], maintainers: [] })).toBe(false);
  });

  it("denies an unrelated user", () => {
    expect(canCreatePackageIn({ _id: "stranger" }, ns)).toBe(false);
  });
});

describe("canPublishPackage", () => {
  const ns = { namespace: "std", admins: [NS_ADMIN_ID], maintainers: [NS_MAINT_ID], author: NS_AUTHOR_ID };
  const pkg = { name: "json", maintainers: [PKG_MAINT_ID] };

  it("allows a package maintainer even with no namespace role", () => {
    expect(canPublishPackage({ _id: PKG_MAINT_ID }, ns, pkg)).toBe(true);
  });

  it("allows namespace admins and maintainers", () => {
    expect(canPublishPackage({ _id: NS_ADMIN_ID }, ns, pkg)).toBe(true);
    expect(canPublishPackage({ _id: NS_MAINT_ID }, ns, pkg)).toBe(true);
  });

  it("allows a site admin", () => {
    expect(canPublishPackage({ _id: "stranger", roles: ["admin"] }, ns, pkg)).toBe(true);
  });

  it("denies an unrelated user", () => {
    expect(canPublishPackage({ _id: "stranger" }, ns, pkg)).toBe(false);
  });
});

describe("managesOnlySelf", () => {
  // Preserved v2.0.1 behaviour: all six /{username}/… routes require the path
  // username to equal the authenticated user's, even for a site admin. Flagged
  // as almost certainly unintended, but changing it silently would be worse.
  it("allows managing your own account", () => {
    expect(managesOnlySelf("alice", "alice")).toBe(true);
  });

  it("blocks managing someone else, including for an admin", () => {
    expect(managesOnlySelf("alice", "bob")).toBe(false);
  });
});

describe("tokenAllows (defect D4 scoping)", () => {
  const valid = (namespaceId: string, packageId: string | null): UploadTokenVerdict => ({
    namespaceId,
    packageId,
    createdBy: "u1",
  });

  it("lets a namespace-scoped token publish anywhere in its namespace", () => {
    const verdict = valid("ns1", null);
    expect(tokenAllows(verdict, "ns1")).toBe(true);
    expect(tokenAllows(verdict, "ns1", "pkg1")).toBe(true);
    expect(tokenAllows(verdict, "ns1", "pkg2")).toBe(true);
  });

  it("stops a namespace-scoped token crossing into another namespace", () => {
    expect(tokenAllows(valid("ns1", null), "ns2")).toBe(false);
  });

  it("restricts a package-scoped token to exactly one package", () => {
    const verdict = valid("ns1", "pkg1");
    expect(tokenAllows(verdict, "ns1", "pkg1")).toBe(true);
    expect(tokenAllows(verdict, "ns1", "pkg2")).toBe(false);
    // A package-scoped token cannot create a brand-new package, because there
    // would be no package id to match.
    expect(tokenAllows(verdict, "ns1", null)).toBe(false);
  });

  it("still enforces the namespace even for a package-scoped token", () => {
    expect(tokenAllows(valid("ns1", "pkg1"), "ns2", "pkg1")).toBe(false);
  });
});