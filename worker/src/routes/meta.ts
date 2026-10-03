/**
 * Meta routes: `/`, `/apidocs`, `/apidocs/openapi.json`.
 *
 * Replaces `flasgger`, which rendered Swagger UI at runtime by shelling into
 * the view layer on every page load. Serving a static, prebuilt OpenAPI 3.1
 * document is both cheaper (cacheable at the edge, ~0 CPU) and closer to the
 * contract we actually implement — the 35 legacy Swagger 2.0 YAMLs drifted badly
 * from the code (defect D31/D32: they document a required `uuid` form field the
 * code never reads, and response fields the code never returns).
 */

import type { Env } from "../db/client";
import { buildOpenApi } from "../lib/openapi";
import { json } from "../lib/responses";

/** `GET /apidocs` — a minimal self-describing landing page. */
export function handleDocsIndex(): Response {
  return json(200, {
    name: "fpm registry api",
    version: "3.0.0",
    openapi: "/apidocs/openapi.json",
    docs: "/apidocs",
  });
}

export function handleOpenapi(path: string, env: Env): Response {
  if (path.endsWith("openapi.json")) {
    return json(
      200,
      buildOpenApi({ version: "3.0.0", environment: env.ENVIRONMENT }),
      // Cacheable: the document changes only on deploy, and the cache key
      // carries the deployment so a redeploy retires it automatically.
      { "cache-control": "public, max-age=3600" },
    );
  }
  return handleDocsIndex();
}
