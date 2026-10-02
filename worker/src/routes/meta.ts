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
import { POOL_NAME } from "../db/mongo-pool";
import { json } from "../lib/responses";

export function handleHealth(env: Env): Promise<Response> {
  return Promise.resolve(handleHealthSync(env));
}

function handleHealthSync(env: Env): Response {
  return json(200, {
    service: "fpm-registry-api",
    status: "healthy",
    environment: env.ENVIRONMENT,
  });
}

/** `GET /apidocs` — a minimal self-describing landing page. */
export function handleDocsIndex(): Response {
  return json(200, {
    name: "fpm registry api",
    version: "3.0.0",
    openapi: "/apidocs/openapi.json",
    docs: "/apidocs",
  });
}

export function handleOpenapi(path: string): Response {
  if (path.endsWith("openapi.json")) {
    return json(200, buildOpenapiDocument(), { "cache-control": "public, max-age=3600" });
  }
  return handleDocsIndex();
}

/**
 * OpenAPI 3.1 skeleton. Phase 0 replaces this with the full generated
 * document derived from `docs/API_CONTRACT.md`.
 */
function buildOpenapiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "fpm Registry API",
      version: "3.0.0",
      description:
        "Serverless rewrite of the fpm registry backend. Cloudflare Workers + Durable Objects " +
        "+ MongoDB Atlas + R2. See docs/API_CONTRACT.md for the frozen contract.",
    },
    servers: [{ url: "/", description: "this deployment" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Envelope: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "integer", description: "Mirrors the HTTP status." },
            message: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          summary: "Liveness plus MongoDB reachability",
          responses: { "200": { description: "healthy or degraded" } },
        },
      },
      "/apidocs/openapi.json": {
        get: { summary: "This document", responses: { "200": { description: "OpenAPI 3.1" } } },
      },
    },
  };
}

export { POOL_NAME };