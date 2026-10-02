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
import { buildSnapshot, pruneArchives } from "./routes/archives";
import { sweepExpiredTokens } from "./lib/upload-tokens";
import { pruneOrphanedTarballs } from "./routes/tarballs";
import { db } from "./db/client";
import { corsHeaders, handlePreflight } from "./lib/cors";
import { logger } from "./lib/logger";
import { isExempt, rateLimitHeaders, rateLimitedResponse } from "./lib/rate-limit-middleware";
import { authenticate } from "./lib/auth";
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

      // Rate limiting, in front of the router rather than inside handlers.
      //
      // The documented scheme is a property of the *endpoint*, so enforcing it
      // per route would mean remembering to add it to each of 43 routes — and the
      // first one forgotten is the one an attacker finds. This chokepoint cannot
      // be forgotten that way.
      //
      // `authenticate` is called here as well as inside the handlers. That is one
      // extra HMAC verification: no database round trip and no KDF, so a fraction
      // of a millisecond, in exchange for counting per account rather than per
      // address. Counting per address would let one user behind a shared NAT deny
      // service to everyone else on it.
      let rateHeaders: Record<string, string> = {};
      if (!isExempt(url.pathname)) {
        const identity = await authenticate(request, env);
        rateHeaders = await rateLimitHeaders(request, env, url, identity?.uuid ?? null);

        if (rateHeaders["retry-after"]) {
          return rateLimitedResponse(url, { ...rateHeaders, ...cors });
        }
      }

      const response = await route(request, env, ctx, url);
      if (response) {
        // Copy the CORS headers on without rebuilding the body.
        const merged = new Headers(response.headers);
        for (const [k, v] of Object.entries(cors)) merged.set(k, v);
        // Advertise the budget so a client can pace itself rather than
        // discovering the limit by being refused. `docs/api-reference.md`
        // documents these headers; before this they were promised and absent.
        for (const [k, v] of Object.entries(rateHeaders)) {
          if (k !== "retry-after") merged.set(k, v);
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: merged,
        });
      }

      // `extra` is body fields; headers go in the fourth argument. Passing
      // `rateHeaders` as `extra` would serialise X-RateLimit-* keys into the JSON
      // body of every 404.
      return jsonError(404, "Page not found", {}, { ...cors, ...rateHeaders });
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
        // The structured logger, like every other cron case below. This one line
        // was a bare console.log, so the hourly bootstrap emitted unstructured
        // output that no log filter could read -- and it is the case most likely
        // to need reading, since it is what repairs index drift after a bad deploy.
        logger.info("cron bootstrap", { result });
        return;
      }
      case "*/30 * * * *": {
        // Phase 7: the search index is the weighted $text index in MongoDB, so
        // there is no separate index to rebuild. What needs refreshing is the
        // namespace autocomplete mirror, which the KV namespace serves.
        return;
      }
      case "0 3 * * *": {
        // Sweep upload tokens that expired over a month ago. On v2.0.1 these
        // were pushed onto namespaces.upload_tokens[] forever with no sweep, so
        // the document grew until it hit the 16 MB cap (defect D4).
        const swept = await sweepExpiredTokens(env, 30);
        logger.info("nightly sweep", { expiredUploadTokens: swept });
        return;
      }
      case "0 4 * * 0": {
        // Weekly R2 maintenance: drop tarballs whose version document is gone.
        // This is the repair path for anything a cascade delete could not reach
        // (defect D12), plus a fresh public snapshot and archive pruning.
        const pruned = await pruneOrphanedTarballs(env, async (namespace, packageName, version) => {
          const doc = await db<unknown>(env, {
            kind: "findOne",
            collection: "packages",
            filter: { name: packageName, namespace_name: namespace, "versions.version": version },
            projection: { _id: 1 },
          });
          return doc !== null;
        });
        const snapshot = await buildSnapshot(env);
        const archives = await pruneArchives(env, 3);
        logger.info("weekly r2 maintenance", {
          tarballsScanned: pruned.scanned,
          tarballsRemoved: pruned.removed,
          snapshot: snapshot?.key ?? null,
          archivesRemoved: archives,
        });
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