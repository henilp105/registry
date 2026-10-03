/**
 * Rate limiting — the control that keeps a public endpoint from being its own
 * denial of service.
 *
 * ── What this closes ─────────────────────────────────────────────────────────
 * `docs/api-reference.md` §"Rate Limiting" documents a scheme with
 * `X-RateLimit-*` headers, and defect D41 records that it is "not implemented
 * anywhere", with a 429 handler that nothing ever raises. The documentation was
 * aspirational; this makes it true, or at least makes the truth match the docs.
 *
 * ── Why fixed windows ───────────────────────────────────────────────────────
 * A fixed window is one counter and one timestamp, needs no eviction sweep, and
 * cannot grow without bound — which matters when the counter store is a Durable
 * Object holding in-memory state. The cost is the classic boundary burst: two
 * windows' worth of traffic can arrive either side of a reset.
 *
 * A sliding window would fix that and needs a deque per key plus eviction. On a
 * free tier the memory ceiling makes unbounded per-key state the wrong trade, so
 * the burst is accepted and documented rather than hidden. For the endpoints that
 * matter here — auth and upload — the limits are small enough that a boundary
 * burst of 20 login attempts is not a compromise worth a more complex store.
 *
 * ── Why the window is reset-by-timestamp and not swept ───────────────────────
 * Entries are overwritten on the next request for that key, so a client that stops
 * calling leaves at most one stale counter behind. Bounded by the number of
 * *distinct* keys seen, not by request volume.
 */

/** The documented budgets. `docs/api-reference.md` §Rate Limiting. */
export const LIMITS = {
  /** Authentication: 10 requests/minute. */
  auth: { limit: 10, windowSeconds: 60 },
  /** Package upload: 5 uploads/hour. */
  upload: { limit: 5, windowSeconds: 3600 },
  /** General API: 100 requests/minute. */
  general: { limit: 100, windowSeconds: 60 },
} as const;

export type LimitKind = keyof typeof LIMITS;

/**
 * Which bucket a route belongs to.
 *
 * Matches on **path segments**, not on the raw pathname string, and it has to:
 * the router matches on `path.split("/").filter(Boolean)`, and those two do not
 * agree on a path with an empty segment. `POST //auth/login` routes to the real
 * login handler -- `seg` is `["auth","login"]` -- while `startsWith("/auth/")` is
 * false, so the attempt was counted against the 100/min general bucket instead
 * of the 10/min auth one (defect D92). Deriving the bucket from the same
 * segmentation the router uses is what closes it, and it means a change to the
 * router's matching rules cannot silently desynchronise the limiter from it.
 */
export function limitKindFor(method: string, path: string): LimitKind {
  const seg = path.split("/").filter(Boolean);
  if (seg[0] === "auth") return "auth";
  // Uploads are the expensive, quota-consuming write. Matched on the exact route
  // rather than "any POST", so a namespace or package deletion is not throttled
  // as though it were a publish.
  if (seg.length === 1 && seg[0] === "packages" && method === "POST") return "upload";
  return "general";
}

/**
 * A counter for one key within one window.
 *
 * `expiresAtMs` is deliberately *not* called `resetAt`: `Decision.resetAt` is in
 * unix **seconds** because that is what the documented header carries, while this
 * is a millisecond timestamp used for comparison. Two same-named fields in
 * different units on adjacent types is an off-by-1000 waiting to happen.
 */
export type Counter = { count: number; expiresAtMs: number };

export type Decision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds at which the window resets. */
  resetAt: number;
  kind: LimitKind;
};

/**
 * Count one request against a key.
 *
 * Pure: takes the current counter (or `undefined`) and returns the next one plus
 * the decision. The caller owns storage, which is what makes this testable without
 * a Durable Object, a clock or a network.
 */
export function consume(
  previous: Counter | undefined,
  kind: LimitKind,
  nowMs: number,
): { counter: Counter; decision: Decision } {
  const { limit, windowSeconds } = LIMITS[kind];
  const windowMs = windowSeconds * 1000;

  // A missing or expired counter starts a fresh window.
  const live = previous !== undefined && previous.expiresAtMs > nowMs;
  const counter: Counter = live
    ? { count: previous.count + 1, expiresAtMs: previous.expiresAtMs }
    : { count: 1, expiresAtMs: nowMs + windowMs };

  const allowed = counter.count <= limit;

  return {
    counter,
    decision: {
      allowed,
      limit,
      // Never negative: a client that has been refused should see 0, not -4.
      remaining: Math.max(0, limit - counter.count),
      resetAt: Math.ceil(counter.expiresAtMs / 1000),
      kind,
    },
  };
}

/**
 * Headers for a response.
 *
 * `X-RateLimit-Reset` is unix **seconds**, matching the documented example
 * (`1612345678`).
 *
 * `Retry-After` is added only when the request was actually refused. Sending it on
 * every response would be noise, and clients that honour it unconditionally would
 * throttle themselves on successful calls.
 */
export function headersFor(decision: Decision): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(decision.resetAt),
  };
  if (!decision.allowed) {
    const retryAfter = Math.max(1, decision.resetAt - Math.floor(Date.now() / 1000));
    headers["retry-after"] = String(retryAfter);
  }
  return headers;
}

/**
 * Identify the caller for rate-limiting purposes.
 *
 * The authenticated identity is preferred over the address: a NAT or a shared CI
 * runner puts many distinct users behind one IP, and throttling them together
 * would let one user deny service to the rest. Anonymous callers fall back to the
 * address, which is the only thing available.
 *
 * Returns a stable, bounded-length key. It is never logged and never exposed: it
 * is a counter index, not a credential.
 */
export function clientKey(request: Request, identity: string | null, cfConnectingIp: string | undefined): string {
  if (identity) return `u:${identity}`;

  const ipHeader =
    cfConnectingIp ??
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  // Client-sent lists may carry "client, proxy1, proxy2" — only the first hop
  // identifies the anonymous caller for bucketing.
  const first = ipHeader.split(",")[0]?.trim() ?? ipHeader;
  // Strip a port only from IPv4-with-port: the old /:\d+$/ replace also ate the
  // trailing group of IPv6 literals ("2001:db8::5" -> "2001:db8:"), collapsing
  // distinct clients into one rate-limit bucket.
  const ipv4WithPort = first.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  const ip = ipv4WithPort ? (ipv4WithPort[1] as string) : first;
  // Cap the length so a hostile header cannot bloat the counter store's keys.
  return `a:${ip.slice(0, 45)}`;
}

/**
 * Fail-open wrapper.
 *
 * A rate limiter that throws takes the API down with it, which is a worse outcome
 * than not rate limiting at all: the control is supposed to reduce availability
 * risk, not add to it. So any failure in accounting yields "allowed", and the
 * caller proceeds without headers.
 *
 * This is a deliberate trade, recorded because it looks wrong at a glance: it is
 * the right call for a limiter protecting a *free tier*, where exceeding a limit
 * costs availability and nothing else.
 */
export async function failOpen<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}
