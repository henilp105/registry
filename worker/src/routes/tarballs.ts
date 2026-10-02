/**
 * GET /tarballs/*, /static/*, /download/* — R2-backed tarball delivery (Phase 6)
 *
 * NOT YET MIGRATED — this is the Phase 1 skeleton. The route is wired into the
 * router so the matching logic, ordering and CORS behaviour can be reviewed and
 * tested now, but it deliberately returns `501` rather than guessing at the
 * behaviour. The frozen contract for this surface is in
 * docs/API_CONTRACT.md; the work items it must satisfy are in
 * docs/BASELINE_AUDIT.md.
 */

import type { Env } from "../db/client";
import { jsonError } from "../lib/responses";
import type { AuthContext } from "../lib/auth";

export async function handleTarballRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: AuthContext | null,
): Promise<Response | null> {
  void request;
  void env;
  void ctx;
  void url;
  void auth;
  return jsonError(501, "Not implemented — pending serverless migration phase", {
    route: `${request.method} /${segments.join("/")}`,
  });
}
