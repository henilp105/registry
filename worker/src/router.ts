/**
 * Route table.
 *
 * Ordering matters here and the reasons are specific to this API — see
 * docs/API_CONTRACT.md §3:
 *
 *   1. `/packages` is BOTH `GET` (search, with a `?query=` string) and `PUT`
 *      (deprecate a package). We therefore match on method *first*.
 *   2. `/{username}/maintainer` and friends put a **dynamic segment at
 *      position 1**. A static-first router would let them shadow `/auth/*`,
 *      `/users/*` and `/packages/*`. We give every static prefix priority and
 *      only fall through to the dynamic branch if nothing else matched.
 *   3. `/namespace/{ns}` (singular, GET) and `/namespaces…` (plural, POST) are
 *      an inconsistency in the original API that we must preserve verbatim.
 *
 * Returns `null` when nothing matches, so the caller can emit the 404.
 */

import type { Env } from "./db/client";
import { jsonOk } from "./lib/responses";
import type { AuthContext } from "./lib/auth";
import { authenticate } from "./lib/auth";
import { handleHealth, handleOpenapi } from "./routes/meta";
import { handleAuthRoutes } from "./routes/auth";
import { handleUserRoutes } from "./routes/users";
import { handleNamespaceRoutes } from "./routes/namespaces";
import { handlePackageRoutes } from "./routes/packages";
import { handleRatingReportRoutes } from "./routes/ratings";
import { handleTarballRoutes } from "./routes/tarballs";
import { handleValidationRoutes } from "./routes/validation";
import { downloadArchive, listArchives } from "./routes/archives";

export type Ctx = ExecutionContext;

export async function route(
  request: Request,
  env: Env,
  ctx: Ctx,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname;
  const seg = path.split("/").filter(Boolean);

  // ── meta ───────────────────────────────────────────────────────────────────
  if (path === "/health" || path === "/healthz") return handleHealth(env);
  if (path === "/" || path === "/apidocs" || path === "/apidocs/openapi.json") {
    if (path === "/") return jsonOk({ message: "fpm registry api", version: "3.0.0" });
    return handleOpenapi(path, env);
  }

  // Resolve identity once per request. `auth` is `null` for anonymous callers;
  // individual routes decide whether they require it. This is what lets the
  // currently-unauthenticated routes stay reachable while Phase 3 closes the
  // `uuid === "undefined"` hole described in API_CONTRACT.md §4.
  const auth: AuthContext | null = await authenticate(request, env);

  // ── static prefixes, highest priority ──────────────────────────────────────
  if (seg[0] === "auth") return handleAuthRoutes(request, env, ctx, seg, url, auth);
  if (seg[0] === "users") return handleUserRoutes(request, env, ctx, seg, url, auth);
  if (seg[0] === "namespaces" || seg[0] === "namespace") {
    return handleNamespaceRoutes(request, env, ctx, seg, url, auth);
  }
  if (seg[0] === "ratings" || seg[0] === "report") {
    return handleRatingReportRoutes(request, env, ctx, seg, url, auth);
  }
  if (seg[0] === "tarballs" || seg[0] === "static" || seg[0] === "download") {
    return handleTarballRoutes(request, env, ctx, seg, url, auth);
  }
  // The validation callback API. Authenticated by a dedicated secret rather
  // than a user JWT, because it can mark any package as verified.
  if (seg[0] === "internal" && seg[1] === "validation") {
    return handleValidationRoutes(request, env, ctx, seg, url, auth);
  }

  // Archives. Previously a 501; now served from R2 under a scoped prefix,
  // which is what structurally prevents the v0.0.1 leak of database-dump
  // filenames (defect D5).
  if (seg[0] === "registry" && seg[1] === "archives" && seg.length === 2) {
    return listArchives(env);
  }
  if (seg[0] === "archives" && seg.length === 2) {
    return downloadArchive(env, seg[1] as string);
  }

  // `/packages` — method dispatch happens inside the handler, per
  // API_CONTRACT.md §3.1 (`GET` = search, `PUT` = deprecate, `POST` = upload).
  if (seg[0] === "packages") {
    return handlePackageRoutes(request, env, ctx, seg, url, auth);
  }

  // ── dynamic first segment: /{username}/{action} ───────────────────────────
  // Reached only when no static prefix matched, so it cannot shadow the above.
  if (seg.length >= 2) {
    const handled = await handleUserRoutes(request, env, ctx, seg, url, auth);
    if (handled) return handled;
  }

  return null;
}