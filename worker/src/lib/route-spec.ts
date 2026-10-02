/**
 * Route table — the single source of truth for routing, and the input to the
 * generated OpenAPI document.
 *
 * ── Why a table rather than scattered conditionals ──────────────────────────
 * The routing rules here are subtle, and every one of them is a bug the original
 * Flask app shipped (docs/API_CONTRACT.md §3):
 *
 *   - `/packages` is three different things depending on method: GET is search,
 *     POST is upload, PUT is deprecate.
 *   - `GET /packages?query=` and `GET /packages/{ns}/{pkg}` share a prefix, so
 *     depth and method both have to be checked.
 *   - `/namespace/{ns}` (singular, GET) coexists with `/namespaces…` (plural,
 *     POST). That inconsistency is preserved verbatim because the frontend
 *     depends on it.
 *   - `/{username}/maintainer` and friends put a **dynamic segment at position
 *     1**. A static-first router would let them shadow `/auth`, `/users` and
 *     `/packages`.
 *
 * Expressing all of that as data means the OpenAPI generator can enumerate the
 * real surface instead of a hand-maintained list that drifts on day one — which
 * is exactly how `v2.0.1` ended up with 54 documented-vs-actual discrepancies.
 */

/**
 * Public `sorted_by` values, declared before the route table so the search route's
 * schema can reference them. Kept in one place so the docs, the handler and
 * this list cannot drift apart.
 */
export const SORTED_BY_VALUES = ["", "name", "updatedat", "createdat", "downloads", "author"] as const;

/** HTTP methods that can carry a request body of this shape. */
export const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

export type ParamSpec = {
  name: string;
  in: "path" | "query" | "form";
  required: boolean;
  description: string;
  schema?: Record<string, unknown>;
};

export type RouteSpec = {
  /** Path template, e.g. `/packages/{namespace_name}/{package_name}`. */
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  operationId: string;
  summary: string;
  tags: string[];
  /** Set when the route accepts multipart/form-data rather than JSON. */
  formBody?: ParamSpec[];
  query?: ParamSpec[];
  security?: "bearer" | "uploadToken" | "validationSecret";
  /** Response codes this route can produce, mapped to a description. */
  responses: Record<string, string>;
  /** Notes about behaviour that is surprising or deliberately preserved. */
  notes?: string;
  /** True when the response is cacheable at the edge. */
  cacheable?: boolean;
};

const OK: Record<string, string> = { "200": "Success" };
const ERR = (codes: string[]): Record<string, string> =>
  Object.fromEntries(codes.map((c) => [c, c === "401" ? "Unauthorized" : c === "403" ? "Forbidden" : c === "404" ? "Not found" : c === "400" ? "Bad request" : c === "413" ? "Payload too large" : "Error"]));

const uuidForm: ParamSpec = {
  name: "uuid",
  in: "form",
  required: false,
  description:
    "Account identifier. Ignored when an Authorization header is present; the JWT identity is authoritative.",
  schema: { type: "string" },
};

/**
 * The complete route surface.
 *
 * Every entry maps to a handler that exists. `/apidocs/openapi.json` is generated
 * from this, so a route that is implemented but unlisted here is a bug the
 * contract test catches.
 */
export const ROUTES: RouteSpec[] = [
  // ── meta ───────────────────────────────────────────────────────────────────
  {
    path: "/",
    method: "GET",
    operationId: "index",
    summary: "Service banner",
    tags: ["meta"],
    responses: OK,
    cacheable: true,
  },
  {
    path: "/health",
    method: "GET",
    operationId: "health",
    summary: "Liveness, plus MongoDB reachability measured through the Durable Object",
    tags: ["meta"],
    // Deliberately not cached: a stale health answer is worse than none.
    responses: { "200": "Healthy or degraded" },
    notes:
      "Returns 200 even when MongoDB is unreachable, with status `degraded`, so an edge " +
      "outage and a database outage are distinguishable. Reports the real server version " +
      "read through the pool.",
  },
  {
    path: "/apidocs/openapi.json",
    method: "GET",
    operationId: "openapi",
    summary: "This document",
    tags: ["meta"],
    responses: OK,
    cacheable: true,
  },

  // ── auth ───────────────────────────────────────────────────────────────────
  {
    path: "/auth/login",
    method: "POST",
    operationId: "login",
    summary: "Exchange credentials for an access and refresh token",
    tags: ["auth"],
    formBody: [
      { name: "user_identifier", in: "form", required: true, description: "Email or username.", schema: { type: "string" } },
      { name: "password", in: "form", required: true, description: "Plaintext password.", schema: { type: "string" } },
    ],
    responses: { ...ERR(["400", "401"]), "200": "Login successful" },
    notes:
      "Returns snake_case `access_token` and `refresh_token` on the wire. A wrong password and " +
      "an unknown account are indistinguishable, and an unverified account gets 401 " +
      "'Please verify your email'.",
  },
  {
    path: "/auth/signup",
    method: "POST",
    operationId: "signup",
    summary: "Create an account",
    tags: ["auth"],
    formBody: [
      { name: "username", in: "form", required: true, description: "3-30 chars, [A-Za-z0-9_-].", schema: { type: "string" } },
      { name: "email", in: "form", required: true, description: "Lowercased before storage.", schema: { type: "string" } },
      { name: "password", in: "form", required: true, description: "At least 8 characters.", schema: { type: "string", minLength: 8 } },
    ],
    responses: { ...ERR(["400"]), "200": "Signup successful; a verification email is on its way" },
    notes:
      "The first account created on an empty database becomes a site admin if and only if its " +
      "password matches SUDO_PASSWORD. After that the latch is permanently closed.",
  },
  {
    path: "/auth/logout",
    method: "POST",
    operationId: "logout",
    summary: "Record a logout",
    tags: ["auth"],
    security: "bearer",
    responses: { ...ERR(["401"]), ...OK },
  },
  {
    path: "/auth/refresh",
    method: "POST",
    operationId: "refreshToken",
    summary: "Exchange a refresh token for a new pair",
    tags: ["auth"],
    security: "bearer",
    formBody: [{ name: "refresh_token", in: "form", required: false, description: "May also be sent as a Bearer token.", schema: { type: "string" } }],
    responses: { ...ERR(["401"]), "200": "A new access and refresh token" },
    notes:
      "New. v0.0.1 issued refresh tokens at login and verify-email but had no route that " +
      "accepted one, so the token the frontend stored was always unusable.",
  },
  {
    path: "/auth/forgot-password",
    method: "POST",
    operationId: "forgotPassword",
    summary: "Request a password reset link",
    tags: ["auth"],
    formBody: [{ name: "email", in: "form", required: true, description: "Account email.", schema: { type: "string" } }],
    responses: { ...ERR(["400"]), "200": "Always the same message, whether or not the address is registered" },
    notes:
      "Returns 200 with an identical message for an unknown or unverified address. v0.0.1 " +
      "returned 404 'User not found', which was a user-enumeration oracle.",
  },
  {
    path: "/auth/reset-password",
    method: "POST",
    operationId: "resetPassword",
    summary: "Set a new password",
    tags: ["auth"],
    security: "bearer",
    formBody: [
      { name: "password", in: "form", required: true, description: "The new password.", schema: { type: "string", minLength: 8 } },
      { name: "oldpassword", in: "form", required: false, description: "Required when changing it while signed in.", schema: { type: "string" } },
      uuidForm,
    ],
    responses: { ...ERR(["400", "401"]), "200": "Password reset successful" },
    notes:
      "Two shapes: the emailed single-use token flow (password + uuid) and the signed-in flow " +
      "(oldpassword + password + Bearer). v0.0.1 raised NameError on this route for every request.",
  },
  {
    path: "/auth/verify-email",
    method: "POST",
    operationId: "verifyEmail",
    summary: "Confirm an email address",
    tags: ["auth"],
    formBody: [
      {
        name: "uuid",
        in: "form",
        required: true,
        description: "The single-use token from the verification email, not the account uuid.",
        schema: { type: "string" },
      },
    ],
    responses: { ...ERR(["401", "404"]), "200": "Verified; tokens issued" },
    notes:
      "Requires a single-use, expiring, 256-bit token. v0.0.1 accepted the raw account uuid " +
      "with no authentication and minted a token pair, which was a token-minting oracle.",
  },
  {
    path: "/auth/change-email",
    method: "POST",
    operationId: "changeEmail",
    summary: "Begin an email change",
    tags: ["auth"],
    security: "bearer",
    formBody: [{ name: "new_email", in: "form", required: true, description: "The requested address.", schema: { type: "string" } }],
    responses: { ...ERR(["400", "401", "404"]), "200": "Confirmation sent to the new address" },
  },

  // ── users ──────────────────────────────────────────────────────────────────
  {
    path: "/users/{username}",
    method: "GET",
    operationId: "getUserProfile",
    summary: "Public profile, packages and namespaces",
    tags: ["users"],
    query: [{ name: "uuid", in: "query", required: false, description: "Unused; retained for compatibility." }],
    responses: { ...ERR(["404"]), "200": "Profile" },
    cacheable: true,
    notes:
      "`user.email` is included only when the caller is the account owner or a site admin. " +
      "v0.0.1 returned it to anyone, unauthenticated.",
  },
  {
    path: "/users/account",
    method: "POST",
    operationId: "getAccount",
    summary: "The authenticated account's own details",
    tags: ["users"],
    security: "bearer",
    responses: { ...ERR(["401", "404"]), "200": "Account details" },
  },
  {
    path: "/users/admin",
    method: "POST",
    operationId: "checkAdmin",
    summary: "Whether the caller is a site admin",
    tags: ["users"],
    security: "bearer",
    responses: { ...ERR(["401", "404"]), "200": "`isAdmin` is the string \"true\"" },
    notes: "`isAdmin` is a string, not a boolean. Preserved because the frontend compares it as a string.",
  },
  {
    path: "/users/delete",
    method: "POST",
    operationId: "deleteUser",
    summary: "Delete a user and everything they own",
    tags: ["users"],
    security: "bearer",
    formBody: [
      { name: "username", in: "form", required: true, description: "Who to delete.", schema: { type: "string" } },
      uuidForm,
    ],
    responses: { ...ERR(["400", "401", "404"]), "200": "User deleted" },
    notes:
      "Cascades in one transaction: their packages, their namespace memberships, every package " +
      "reference on namespaces and other users, and their upload tokens.",
  },

  // ── maintainership ─────────────────────────────────────────────────────────
  ...(["maintainer", "maintainer/remove", "namespace/maintainer", "namespace/maintainer/remove", "namespace/admin", "namespace/admin/remove"] as const).map(
    (action): RouteSpec => {
      const isAdd = !action.endsWith("remove");
      const kind = action.includes("namespace/admin")
        ? "namespace admin"
        : action.includes("namespace")
          ? "namespace maintainer"
          : "package maintainer";
      const accountParam: ParamSpec = { name: "username", in: "form", required: true, description: "The account being changed.", schema: { type: "string" } };
      const namespaceParam: ParamSpec = { name: "namespace", in: "form", required: true, description: "Namespace name.", schema: { type: "string" } };
      const packageParam: ParamSpec = { name: "package", in: "form", required: true, description: "Package name.", schema: { type: "string" } };
      return {
        path: `/{username}/${action}`,
        method: "POST",
        operationId: `${isAdd ? "add" : "remove"}${action.replace(/\//g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ /g, "")}`,
        summary: `${isAdd ? "Add" : "Remove"} a ${kind}`,
        tags: ["maintainers"],
        security: "bearer",
        formBody: [
          accountParam,
          namespaceParam,
          ...(action.startsWith("maintainer") && !action.includes("namespace") ? [packageParam] : []),
          uuidForm,
        ],
        responses: { ...ERR(["400", "401", "404"]), "200": isAdd ? "Added, or already a member" : "Removed, or was not a member" },
        notes:
          "The path username must equal the authenticated user's own, even for a site admin. " +
          "That is almost certainly unintended, and is preserved deliberately rather than " +
          "silently changed.",
      };
    },
  ),

  // ── namespaces ─────────────────────────────────────────────────────────────
  {
    path: "/namespaces",
    method: "POST",
    operationId: "createNamespace",
    summary: "Create a namespace",
    tags: ["namespaces"],
    security: "bearer",
    formBody: [
      { name: "namespace", in: "form", required: true, description: "1-64 chars, [A-Za-z0-9_-].", schema: { type: "string" } },
      { name: "namespace_description", in: "form", required: true, description: "Free text.", schema: { type: "string" } },
    ],
    responses: { ...ERR(["400", "401"]), "200": "Namespace created" },
    notes: "Accepts JSON as well as form data. The creator is seeded into author, admins and maintainers.",
  },
  {
    path: "/namespaces/{namespace_name}/uploadToken",
    method: "POST",
    operationId: "createNamespaceUploadToken",
    summary: "Mint a namespace-scoped publish token",
    tags: ["namespaces"],
    security: "bearer",
    responses: { ...ERR(["401", "404"]), "200": "`uploadToken` and `upload_token`, both the same value" },
    notes:
      "Valid for 7 days, revocable via the revoke route. Only the SHA-256 is stored, so a " +
      "database dump yields nothing usable.",
  },
  {
    path: "/namespaces/{namespace_name}/uploadToken/{token_id}/revoke",
    method: "POST",
    operationId: "revokeUploadToken",
    summary: "Revoke an upload token",
    tags: ["namespaces"],
    security: "bearer",
    responses: { ...ERR(["401", "404"]), "200": "Revoked" },
    notes: "New. v0.0.1 had no revoke path at all, so a leaked token stayed valid for its full lifetime.",
  },
  {
    path: "/namespaces/{namespace_name}/admins",
    method: "POST",
    operationId: "listNamespaceAdmins",
    summary: "List namespace admins",
    tags: ["namespaces"],
    responses: { ...ERR(["404"]), "200": "`users: [{id, username}]`" },
    cacheable: true,
    notes: "A read expressed as POST, because that is what the original does and the frontend depends on. The key is `users`, not `admins`.",
  },
  {
    path: "/namespaces/{namespace_name}/maintainers",
    method: "POST",
    operationId: "listNamespaceMaintainers",
    summary: "List namespace maintainers",
    tags: ["namespaces"],
    responses: { ...ERR(["404"]), "200": "`users: [{id, username}]`" },
    cacheable: true,
    notes: "A read expressed as POST. The key is `users`, not `maintainers`.",
  },
  {
    path: "/namespace/{namespace_name}",
    method: "GET",
    operationId: "getNamespace",
    summary: "A namespace and its packages",
    tags: ["namespaces"],
    responses: { ...ERR(["404"]), "200": "`packages` and `createdAt`" },
    cacheable: true,
    notes: "Singular path segment. Preserved: the plural form is used only for writes.",
  },
  {
    path: "/namespace/{namespace_name}/delete",
    method: "POST",
    operationId: "deleteNamespace",
    summary: "Delete a namespace and cascade",
    tags: ["namespaces"],
    security: "bearer",
    responses: { ...ERR(["401", "404"]), "200": "Namespace deleted" },
    notes:
      "Site admins only. Cascades to packages, user references and upload tokens in one " +
      "transaction. v0.0.1 compared the namespace name against an ObjectId, so it never " +
      "deleted anything and always returned code:500 at HTTP 200.",
  },

  // ── packages ───────────────────────────────────────────────────────────────
  {
    path: "/packages",
    method: "GET",
    operationId: "searchPackages",
    summary: "Search packages",
    tags: ["packages"],
    query: [
      { name: "query", in: "query", required: false, description: "Search text. Defaults to \"fortran\".", schema: { type: "string", default: "fortran" } },
      { name: "page", in: "query", required: false, description: "Zero-based.", schema: { type: "integer", minimum: 0, default: 0 } },
      {
        name: "sorted_by",
        in: "query",
        required: false,
        description: "Public sort name. Each maps onto a field that exists on the document.",
        schema: { type: "string", default: "", enum: SORTED_BY_VALUES },
      },
      { name: "sort", in: "query", required: false, description: "asc or desc.", schema: { type: "string", enum: ["asc", "desc"] } },
      { name: "limit", in: "query", required: false, description: "Page size, hard-capped at 50.", schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
    ],
    responses: { ...ERR(["400"]), "200": "`packages` and `total_pages`. An empty result is 200 with an empty array, never 404" },
    cacheable: true,
    notes:
      "Uses the weighted `$text` index. `sorted_by` maps onto real document fields: v0.0.1 " +
      "accepted `updatedat` and `downloads`, neither of which existed, so both silently fell " +
      "back to sorting by name.",
  },
  {
    path: "/packages",
    method: "POST",
    operationId: "uploadPackage",
    summary: "Publish a package version",
    tags: ["packages"],
    security: "uploadToken",
    formBody: [
      { name: "upload_token", in: "form", required: true, description: "A 7-day publish token. There is no JWT auth on this route.", schema: { type: "string" } },
      { name: "package_name", in: "form", required: true, description: "1-64 chars, [A-Za-z0-9_-].", schema: { type: "string" } },
      { name: "package_version", in: "form", required: true, description: "Semver. 0.0.0 is rejected.", schema: { type: "string" } },
      { name: "package_license", in: "form", required: true, description: "SPDX identifier or expression.", schema: { type: "string" } },
      { name: "dry_run", in: "form", required: false, description: "Validate without persisting anything.", schema: { type: "string", enum: ["true", "false"] } },
      { name: "tarball", in: "form", required: true, description: "The .tar.gz artifact, at most 50 MB.", schema: { type: "string", format: "binary" } },
    ],
    responses: { ...ERR(["400", "401", "404", "413"]), "200": "Package Uploaded Successfully." },
    notes:
      "Streams the artifact to R2 and records a SHA-256 on the version. A namespace-scoped " +
      "token may publish anywhere in the namespace; a package-scoped token only its own " +
      "package. `dry_run` persists nothing at all.",
  },
  {
    path: "/packages",
    method: "PUT",
    operationId: "deprecatePackage",
    summary: "Deprecate or un-deprecate a package",
    tags: ["packages"],
    security: "bearer",
    formBody: [
      { name: "name", in: "form", required: true, description: "Package name.", schema: { type: "string" } },
      { name: "namespace", in: "form", required: true, description: "Namespace name.", schema: { type: "string" } },
      { name: "isDeprecated", in: "form", required: false, description: "\"true\" or \"false\".", schema: { type: "string", enum: ["true", "false"] } },
      uuidForm,
    ],
    responses: { ...ERR(["400", "401", "404"]), "200": "Deprecation state changed" },
    notes: "New route. v0.0.1 had none, so the frontend's deprecate call got a 405 and nothing could ever be reversed.",
  },
  {
    path: "/packages/{namespace_name}/{package_name}",
    method: "GET",
    operationId: "getPackage",
    summary: "One package, with its version history",
    tags: ["packages"],
    responses: { ...ERR(["404"]), "200": "`{ code: 200, data: {...} }`" },
    cacheable: true,
    notes:
      "`latest_version_data` is the newest version by semver. v0.0.1 sorted versions as " +
      "strings and reported versions[-1], so a package holding both 0.9.0 and 0.10.0 " +
      "advertised 0.9.0 as latest. Each version carries both `is_deprecated` (boolean) and " +
      "`isDeprecated` (string), because the frontend reads the latter.",
  },
  {
    path: "/packages/{namespace_name}/{package_name}/{version}",
    method: "GET",
    operationId: "getPackageVersion",
    summary: "One version of a package",
    tags: ["packages"],
    responses: { ...ERR(["404"]), "200": "`{ code: 200, data: {...} }`" },
    cacheable: true,
    notes: "Exact semver match, so 0.1 does not resolve 0.10.0.",
  },
  {
    path: "/packages/{namespace_name}/{package_name}/verify",
    method: "POST",
    operationId: "verifyPackageRole",
    summary: "Whether the caller may publish here",
    tags: ["packages"],
    security: "bearer",
    formBody: [uuidForm],
    responses: { ...ERR(["401", "404"]), "200": "`{ status, isVerified }`" },
    notes:
      "v0.0.1 queried `namespace` with the namespace *name* against a field holding an " +
      "ObjectId, so this always 404'd and the frontend's role-gated controls never appeared.",
  },
  {
    path: "/packages/{namespace_name}/{package_name}/maintainers",
    method: "GET",
    operationId: "listPackageMaintainers",
    summary: "List package maintainers",
    tags: ["packages"],
    responses: { ...ERR(["404"]), "200": "`users: [{id, username}]`" },
    cacheable: true,
    notes: "Also accepted over POST, because the original allowed either verb.",
  },
  {
    path: "/packages/{namespace_name}/{package_name}/uploadToken",
    method: "POST",
    operationId: "createPackageUploadToken",
    summary: "Mint a package-scoped publish token",
    tags: ["packages"],
    security: "bearer",
    responses: { ...ERR(["401", "404"]), "200": "`upload_token` and `uploadToken`, both the same value" },
    notes:
      "v0.0.1 minted these into a collection the upload path never read, so the UI handed out " +
      "credentials that could authorise nothing.",
  },
  {
    path: "/packages/{namespace_name}/{package_name}/delete",
    method: "POST",
    operationId: "deletePackage",
    summary: "Delete a package and cascade",
    tags: ["packages"],
    security: "bearer",
    formBody: [uuidForm],
    responses: { ...ERR(["401", "404"]), "200": "Package deleted successfully" },
    notes: "Site admins only. Cascades to namespace and user references; tarballs are pruned.",
  },
  {
    path: "/packages/{namespace_name}/{package_name}/{version}/delete",
    method: "POST",
    operationId: "deletePackageVersion",
    summary: "Delete one version",
    tags: ["packages"],
    security: "bearer",
    formBody: [uuidForm],
    responses: { ...ERR(["401", "404"]), "200": "Package version deleted successfully" },
    notes:
      "v0.0.1 never checked the version existed and returned success for any string, so a typo " +
      "reported a deletion that had not happened.",
  },
  {
    path: "/packages_cli",
    method: "GET",
    operationId: "searchPackagesCli",
    summary: "Search, shaped for the fpm CLI",
    tags: ["packages"],
    query: [
      { name: "query", in: "query", required: false, description: "Search text.", schema: { type: "string" } },
      { name: "page", in: "query", required: false, description: "One-based. Deliberately unlike /packages.", schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "license", in: "query", required: false, description: "SPDX filter.", schema: { type: "string" } },
      { name: "namespace", in: "query", required: false, description: "Namespace filter.", schema: { type: "string" } },
      { name: "package", in: "query", required: false, description: "Package name filter.", schema: { type: "string" } },
      { name: "limit", in: "query", required: false, description: "Page size, capped at 50.", schema: { type: "integer", maximum: 50 } },
      { name: "sorted_by", in: "query", required: false, description: "Sort field.", schema: { type: "string" } },
      { name: "sort", in: "query", required: false, description: "asc or desc.", schema: { type: "string", enum: ["asc", "desc"] } },
    ],
    responses: { ...ERR(["400"]), "200": "`packages` and `total_pages`" },
    notes: "Undocumented on v0.0.1: its `@swag_from` referenced a YAML file that does not exist, so the spec build broke.",
  },

  // ── ratings and reports ────────────────────────────────────────────────────
  {
    path: "/ratings/{namespace_name}/{package_name}",
    method: "POST",
    operationId: "ratePackage",
    summary: "Rate a package, 1 to 5",
    tags: ["ratings"],
    security: "bearer",
    formBody: [{ name: "rating", in: "form", required: true, description: "A whole number 1-5.", schema: { type: "integer", minimum: 1, maximum: 5 } }],
    responses: { ...ERR(["400", "401", "404"]), "200": "Ratings Submitted Successfully" },
    notes: "One rating per user; re-posting overwrites. Counts are recomputed by aggregation, so concurrent votes cannot lose each other.",
  },
  {
    path: "/report/{namespace_name}/{package_name}",
    method: "POST",
    operationId: "reportPackage",
    summary: "Report a package as malicious",
    tags: ["reports"],
    security: "bearer",
    formBody: [{ name: "reason", in: "form", required: true, description: "At least 10 characters.", schema: { type: "string", minLength: 10 } }],
    responses: { ...ERR(["400", "401", "404"]), "200": "Malicious Report Submitted Successfully" },
  },
  {
    path: "/report/view",
    method: "GET",
    operationId: "viewReports",
    summary: "The unreviewed report queue",
    tags: ["reports"],
    security: "bearer",
    responses: { ...ERR(["401"]), "200": "`reports`, which are marked viewed by being read" },
    notes:
      "Site admins only. Marks what it returns as viewed. v0.0.1 was read-only, so the same " +
      "queue was returned forever and the flag was never cleared anywhere.",
  },

  // ── tarballs ───────────────────────────────────────────────────────────────
  {
    path: "/tarballs/{namespace_name}/{package_name}/{version}",
    method: "GET",
    operationId: "downloadTarball",
    summary: "Download a package artifact",
    tags: ["tarballs"],
    responses: { ...ERR(["404"]), "200": "The .tar.gz, with X-Checksum-SHA256" },
    cacheable: true,
    notes:
      "Served straight from R2 with no database read, because the key is derivable from the " +
      "path. `/download/...` and the legacy `/tarballs/<ObjectId>` shape also route here.",
  },
  {
    path: "/tarballs/usage",
    method: "GET",
    operationId: "tarballUsage",
    summary: "R2 usage against the 10 GB free-tier ceiling",
    tags: ["tarballs"],
    responses: OK,
  },

  // ── registry ───────────────────────────────────────────────────────────────
  {
    path: "/registry/archives",
    method: "GET",
    operationId: "listArchives",
    summary: "Registry snapshot archives",
    tags: ["meta"],
    responses: { ...ERR(["404"]), "200": "`archives: [{name, size, modified}]`" },
    cacheable: true,
    notes:
      "Lists only objects under the archives prefix in R2. v0.0.1 returned os.listdir of the " +
      "static directory, which exposed the filename of every full-database mongodump to anyone.",
  },
  {
    path: "/archives/{name}",
    method: "GET",
    operationId: "downloadArchive",
    summary: "Download a snapshot archive",
    tags: ["meta"],
    responses: { ...ERR(["404"]), "200": "The archive" },
  },

  // ── validation callback ────────────────────────────────────────────────────
  {
    path: "/internal/validation/pending",
    method: "GET",
    operationId: "pendingValidation",
    summary: "Versions awaiting validation",
    tags: ["internal"],
    security: "validationSecret",
    query: [{ name: "limit", in: "query", required: false, description: "1-50.", schema: { type: "integer", maximum: 50, default: 10 } }],
    responses: { ...ERR(["401", "503"]), "200": "`jobs`" },
    notes: "Called by GitHub Actions. Fails closed with 503 when VALIDATION_SECRET is unset.",
  },
  {
    path: "/internal/validation/result",
    method: "POST",
    operationId: "submitValidationResult",
    summary: "Report validation verdicts",
    tags: ["internal"],
    security: "validationSecret",
    responses: { ...ERR(["400", "401", "503"]), "200": "`applied` and `failed` counts" },
    notes: "An allow-list of fields is enforced, and every free-text field is length-bounded.",
  },
];
