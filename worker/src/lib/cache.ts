/**
 * Edge cache.
 *
 * ── What this actually saves, measured against the free tier ────────────────
 * A cache hit does **not** bypass the Worker: the Worker still runs, because
 * the routing logic lives in it. What a hit avoids is the MongoDB round trip.
 * That matters twice over:
 *
 *   1. Atlas Free (M0) is capped at **100 operations/second**. A search is two
 *      operations (`find` + `countDocuments`), so 50 uncached searches/second
 *      exhausts the tier.
 *   2. Each round trip is real wall-clock latency from wherever the request
 *      landed. The cluster is in ap-south-1, so a client in Europe pays ~120 ms
 *      of pure network time on every uncached read.
 *
 * ── Why the Cache API rather than KV ─────────────────────────────────────────
 * The Cache API is **per-PoP and in-memory**, needs no eventual-consistency
 * window, and has no per-key operation accounting. Workers KV is globally
 * replicated and *eventually* consistent — for a package registry, serving a
 * stale version list for up to 60 seconds after a publish is a user-visible
 * bug ("I just published 1.2.0 and it is not there").
 *
 * KV is kept for the two things that genuinely want global replication and a
 * slow TTL: the search index mirror and the long-lived archive listing.
 *
 * ── Invalidation ────────────────────────────────────────────────────────────
 * Because the Cache API has no `delete-by-prefix`, invalidation is by TTL plus
 * a versioned cache key. Every mutating route bumps a monotonic counter for the
 * entity in KV; read keys embed that counter. A publish therefore retires every
 * stale entry immediately rather than waiting out a TTL, without needing an
 * index of what to purge.
 */

export type CacheEnv = {
  CACHE: KVNamespace;
};

export type CachePolicy = {
  /** Seconds. `0` disables caching entirely. */
  ttl: number;
  /**
   * Bump to force a miss without changing the URL. Mutating routes use this
   * together with `invalidate` so stale entries cannot be served.
   */
  version?: string;
};

/**
 * Per-route TTLs.
 *
 * Chosen against two competing costs. A shorter TTL means fresher data but
 * more MongoDB reads against the 100 ops/sec cap; a longer TTL risks showing a
 * user something that has just changed. Package metadata changes rarely, so
 * these are generous. Anything that reflects a *user action* (ratings,
 * malicious reports) is cached far more briefly, because that is where a stale
 * read is actually noticed.
 */
export const TTL = {
  /** Package detail page. */
  package: 300,
  /** A single version. */
  version: 300,
  /** Search results: shorter, because `page` keys multiply the entry count. */
  search: 120,
  /** Namespace + its package list. */
  namespace: 300,
  /** Maintainer/admin rosters. */
  members: 600,
  /** Namespace listing for autocomplete. */
  namespaceIndex: 900,
  /** Ratings: a user submits one and expects to see it. */
  ratings: 30,
  /** Malicious reports: admin triage, so near-zero. */
  reports: 15,
  /** Tarball download redirects. */
  tarball: 3600,
  /** `0` — anything carrying a personal email address. */
  private: 0,
} as const;

/**
 * Build a cache key.
 *
 * Only GET/HEAD are cacheable, and the key must vary on the parts that change
 * the response. Query parameters are sorted so `?a=1&b=2` and `?b=2&a=1`
 * share one entry rather than halving the effective cache.
 */
export function cacheKey(url: URL, version?: string): string {
  const params = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length > 0 ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  const v = version ? `@${version}` : "";
  return `https://cache.local${url.pathname}${query}${v}`;
}

/**
 * Look up a cached response.
 *
 * Returns `null` on a miss. Never throws: a cache failure must degrade to a
 * slow response, not to a 500.
 */
export async function cacheGet(url: URL, version?: string): Promise<Response | null> {
  const key = cacheKey(url, version);
  const cache = caches.default;
  try {
    const hit = await cache.match(key);
    if (!hit) return null;

    // Mark the hit so logs and tests can tell cache behaviour apart.
    const headers = new Headers(hit.headers);
    headers.set("x-cache", "HIT");
    return new Response(hit.body, { status: hit.status, headers });
  } catch {
    return null;
  }
}

/**
 * Store a response.
 *
 * `cache-control` is set explicitly rather than copied from the upstream, so a
 * cacheable body can never inherit a private/no-store policy and poison the
 * shared cache. The KV namespace is *not* used as the store here — see the
 * module comment — so a store failure is silently non-fatal.
 */
export async function cachePut(
  url: URL,
  response: Response,
  ttl: number,
  version?: string,
): Promise<void> {
  if (ttl <= 0) return;
  // Never cache an error, a partial body, or anything auth-bearing.
  if (response.status >= 400) return;
  if (response.headers.get("set-cookie")) return;

  try {
    const headers = new Headers(response.headers);
    headers.set("cache-control", `public, max-age=${ttl}`);
    headers.set("x-cache", "MISS");
    const body = await response.clone().arrayBuffer();

    await caches.default.put(
      cacheKey(url, version),
      new Response(body, { status: response.status, headers }),
    );
  } catch {
    // A cache write must never fail a request.
  }
}

/**
 * A stable version token for an entity, used to retire stale entries.
 *
 * Stored in KV rather than the Cache API because it must be readable from any
 * PoP while a request is being routed. A missing token means "never
 * invalidated", which is the correct default for a cold cache.
 */
export async function entityVersion(env: CacheEnv, entity: string): Promise<string> {
  try {
    const value = await env.CACHE.get(`ver:${entity}`);
    return value ?? "0";
  } catch {
    return "0";
  }
}

/**
 * Retire every cached entry for an entity.
 *
 * Cheap, because it is a single KV write rather than a cache purge: the next
 * read of any route keyed on this entity computes a new key and misses.
 */
export async function invalidate(env: CacheEnv, ...entities: string[]): Promise<void> {
  const now = String(Date.now());
  try {
    await Promise.all(
      entities.map((entity) => env.CACHE.put(`ver:${entity}`, now, { expirationTtl: 86_400 })),
    );
  } catch (err) {
    // Invalidation failing means users may see stale data until the TTL
    // expires. Worth logging, but not worth failing the write that triggered it.
    console.error("cache invalidation failed", entities, err instanceof Error ? err.message : err);
  }
}

/** Cache keys that vary by entity and therefore need invalidating on change. */
export const ENTITY = {
  package: (ns: string, name: string) => `pkg:${ns}/${name}`,
  namespace: (ns: string) => `ns:${ns}`,
  /** Every package in a namespace, so a publish or delete retires its list. */
  namespacePackages: (ns: string) => `nspkgs:${ns}`,
  user: (username: string) => `user:${username}`,
  search: (query: string) => `search:${query}`,
} as const;

/**
 * Serve a read with caching, ETag revalidation and compression headers.
 *
 * The ETag is derived from the body, so a `304` is a pure CPU-cheap path that
 * costs no MongoDB read and no bytes on the wire. Deriving it from the content
 * rather than a timestamp also means it is correct for free.
 */
export async function serveCached(
  request: Request,
  url: URL,
  ttl: number,
  version: string | undefined,
  loader: () => Promise<Response>,
): Promise<Response> {
  if (ttl > 0) {
    const hit = await cacheGet(url, version);
    if (hit) return hit;
  }

  const fresh = await loader();

  // Defect D80: deriving an ETag buffers the *entire* artifact, and cachePut
  // then buffers it again. On a 50 MB tarball that is two full copies held at
  // once against the 128 MB Worker limit, and the SHA-1 over 50 MB alone can
  // exceed the 10 ms CPU ceiling (error 1102). Small JSON payloads still get
  // the ETag win; anything large is streamed past the cache.
  const MAX_ETAG_BYTES = 4 * 1024 * 1024;
  const declaredLength = Number(fresh.headers.get("content-length") ?? NaN);
  const tooLargeForEtag = Number.isFinite(declaredLength) && declaredLength > MAX_ETAG_BYTES;

  // Build a strong ETag over the body bytes.
  let etag: string | undefined;
  if (fresh.status === 200 && !tooLargeForEtag) {
    try {
      const bytes = await fresh.clone().arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-1", bytes);
      etag = `"${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
    } catch {
      etag = undefined;
    }
  }

  const headers = new Headers(fresh.headers);
  if (etag) {
    headers.set("etag", etag);
    // Conditional request: skip the body entirely.
    const inm = request.headers.get("if-none-match");
    if (inm && inm.split(",").some((t) => t.trim() === etag)) {
      return new Response(null, { status: 304, headers });
    }
  }

  // Defect D80: never re-buffer a large artifact into the Cache API.
  if (ttl > 0 && !tooLargeForEtag) await cachePut(url, fresh, ttl, version);

  return new Response(fresh.body, { status: fresh.status, headers });
}