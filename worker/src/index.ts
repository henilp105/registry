/**
 * fpm-registry-api — Worker entry point.
 *
 * Implements the Phase 1 skeleton: routing, CORS, health, and the error
 * envelope, with full behavioural parity against the Flask app on `v2.0.1`.
 * Business routes land in Phases 2b-9.
 *
 * Every response shape here is dictated by docs/API_CONTRACT.md §1:
 *   success => HTTP 2xx AND body `code: 200`
 *   failure => HTTP non-2xx AND body `{ code, message }`
 */

import { MongoPool, POOL_NAME } from "./db/mongo-pool";
import type { Env } from "./db/client";
import { INDEX_SPEC, EXPECTED_COLLECTIONS } from "./db/indexes";
import { corsHeaders, handlePreflight } from "./lib/cors";
import { json, jsonError, jsonOk, ok, securityHeaders } from "./lib/responses";
import { route } from "./router";

export { MongoPool };

const VERSION = "3.0.0";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Preflight first — it never reaches the router.
    const preflight = handlePreflight(request, env);
    if (preflight) return preflight;

    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    // Normalise a trailing slash so `/auth/login/` and `/auth/login` match.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    try {
      // Health checks must answer even when MongoDB is unreachable, otherwise
      // a DB blip makes the whole edge look dead. Mirrors v2.0.1's `/health`.
      if (url.pathname === "/health") {
        return healthResponse(env, cors);
      }

      const response = await route(request, env, ctx, url);
      if (response) {
        // Copy the CORS headers on without rebuilding the body.
        const merged = new Headers(response.headers);
        for (const [k, v] of Object.entries(cors)) merged.set(k, v);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: merged,
        });
      }

      return jsonError(404, "Page not found", cors);
    } catch (err) {
      // Defect S20/D8: never echo an internal message or stack to the client.
      console.error("unhandled", url.pathname, err instanceof Error ? err.message : err);
      return jsonError(500, "Internal server error", cors);
    }
  },

  /** Cron triggers — see the `triggers.crons` block in wrangler.jsonc. */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(event.cron, env));
  },
};

/**
 * `/health` — reports liveness plus MongoDB reachability from the pool.
 *
 * `degraded` still returns 200 so the edge stays in rotation; only a total
 * failure to reach the Durable Object returns 503.
 */
async function healthResponse(env: Env, cors: Record<string, string>): Promise<Response> {
  const body: Record<string, unknown> = {
    service: "fpm-registry-api",
    status: "healthy",
    version: VERSION,
    environment: env.ENVIRONMENT,
    mongo: { connected: false, checked: false },
    ts: new Date().toISOString(),
  };

  try {
    const id = env.MONGO_POOL.idFromName(POOL_NAME);
    const health = await env.MONGO_POOL.get(id, { locationHint: "apac" }).health();
    body.mongo = { connected: health.connected, checked: true, serverVersion: health.serverVersion };
    if (!health.connected) {
      body.status = "degraded";
    }
  } catch (err) {
    body.status = "degraded";
    body.mongo = { connected: false, checked: true, error: err instanceof Error ? err.message : "unreachable" };
  }

  return json(200, body, cors);
}

/** Dispatch the four free Cron Triggers. Phases 7-8 fill in the real work. */
async function handleCron(cron: string, env: Env): Promise<void> {
  try {
    // Every cron starts by warming the pool, so the first real user request
    // never pays the SCRAM + TLS handshake inside a 10 ms budget.
    const id = env.MONGO_POOL.idFromName(POOL_NAME);
    const pool = env.MONGO_POOL.get(id, { locationHint: "apac" });
    await pool.warm();

    switch (cron) {
      case "17 * * * *": {
        // Hourly: make collections and indexes self-healing. Idempotent, so
        // this also repairs drift if a deploy ever lands out of order.
        const result = await pool.execute({
          op: { kind: "bootstrap", collections: [...EXPECTED_COLLECTIONS], spec: INDEX_SPEC },
        });
        console.log("cron bootstrap", JSON.stringify(result));
        return;
      }
      case "*/30 * * * *": {
        // Phase 7 rebuilds the search index here.
        return;
      }
      case "0 3 * * *": {
        // Phase 8: sweep expired upload tokens (defect D4).
        return;
      }
      case "0 4 * * 0": {
        // Phase 6: prune orphaned tarballs from R2 (defect D12).
        return;
      }
      default:
        console.warn(`unhandled cron: ${cron}`);
    }
  } catch (err) {
    console.error(`cron ${cron} failed`, err instanceof Error ? err.message : err);
  }
}

/** Exported for tests: assert the shared headers are present. */
export const __internal = { VERSION, jsonOk, ok, securityHeaders };