/**
 * Per-request rate limiting, applied at the edge.
 *
 * ── Why this lives at the Worker rather than only in handlers ───────────────
 * Because the documented scheme is a property of the *endpoint*, not of a
 * handler. Enforcing it per route would mean remembering to add it to each of 43
 * routes, and the first one forgotten is the one an attacker finds. One chokepoint
 * in front of the router cannot be forgotten that way.
 *
 * ── Why the counters live in the Mongo Durable Object ────────────────────────
 * Three reasons, and the last is the decisive one:
 *
 *   1. Workers isolates are ephemeral and there are many of them, so an in-Worker
 *      counter would be per-isolate and trivially bypassed.
 *   2. Workers KV is *eventually consistent*, so a rate-limit counter in KV can
 *      lag — which means it can under-count, i.e. not actually rate limit.
 *   3. A DO instance is single-threaded, so read-modify-write on a counter is
 *      atomic without a lock. That property is what makes the limit real rather
 *      than approximate.
 *
 * It reuses the existing MongoPool DO rather than adding a second class, so the
 * cost is zero: no new binding, no migration, and no additional Durable Object
 * request on any route that already touches the database.
 *
 * ── What is deliberately NOT limited ────────────────────────────────────────
 * Health checks, the docs landing page, and a handful of liveness probes
 * (`ALWAYS_ALLOWED`). Everything else — including requests that will
 * ultimately be served from the KV cache — passes through the counter,
 * because the counter *is* the thing that costs a Mongo round trip: the
 * KV cache sits behind this middleware, not in front of it. That is the
 * price of counting per account rather than per address.
 */

import type { Env } from "../db/client";
import { db } from "../db/client";
import {
  clientKey,
  failOpen,
  headersFor,
  limitKindFor,
  type Decision,
  type LimitKind,
} from "./rate-limit";
import { logger } from "./logger";

/** Paths that must never be refused. Health checks are for monitoring. */
const ALWAYS_ALLOWED = new Set(["/health", "/healthz", "/", "/apidocs", "/apidocs/openapi.json"]);

type RateDecision = Decision & { kind: LimitKind };

/**
 * Count this request and return the headers to attach.
 *
 * Never throws. `failOpen` covers the Durable Object call; a limiter that takes
 * the API down when *it* breaks is worse than no limiter, because its whole
 * purpose is to reduce availability risk.
 */
export async function rateLimitHeaders(
  request: Request,
  env: Env,
  url: URL,
  identity: string | null,
): Promise<Record<string, string>> {
  const kind = limitKindFor(request.method.toUpperCase(), url.pathname);

  const decision = await failOpen<RateDecision | null>(
    () =>
      db<RateDecision>(env, {
        kind: "rateLimit",
        key: clientKey(request, identity, request.headers.get("cf-connecting-ip") ?? undefined),
        bucket: kind,
        nowMs: Date.now(),
      }),
    null,
  );

  // No decision means the counter store was unreachable. Proceed, without
  // headers, rather than pretending to a limit that is not being applied.
  if (!decision) return {};

  if (!decision.allowed) {
    logger.warn("rate limited", {
      path: url.pathname,
      kind: decision.kind,
      identity: identity ?? "anonymous",
    });
  }

  return headersFor(decision);
}

/** 429 body, shaped like every other error so clients have one thing to parse. */
export function rateLimitedResponse(url: URL, headers: Record<string, string>): Response {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new Response(
    JSON.stringify({
      code: 429,
      message: "Rate limit exceeded. Please retry after the interval in the Retry-After header.",
      path: url.pathname,
    }),
    { status: 429, headers: merged },
  );
}

/** Should this path bypass limiting entirely? */
export function isExempt(pathname: string): boolean {
  return ALWAYS_ALLOWED.has(pathname);
}
