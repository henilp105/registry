/**
 * CORS — replaces the Flask `CORS(app, resources={r"/*": {"origins": "*"}},
 * supports_credentials=True)` wildcard.
 *
 * Defect D3 in docs/BASELINE_AUDIT.md: the legacy app allows every origin to
 * send an `Authorization: Bearer` header, with `supports_credentials` on. Once
 * this API sits behind a public CDN that becomes a token-exfiltration surface.
 *
 * Here we allow-list origins from the `ALLOWED_ORIGINS` env var and reflect
 * only a known-good origin. An unknown `Origin` gets no CORS headers at all,
 * which the browser then blocks — fail closed.
 */

export type CorsEnv = {
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
};

/** Parse the comma-separated allow-list once per invocation. */
export function allowedOrigins(env: CorsEnv): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  );
}

/**
 * Resolve CORS headers for a request.
 *
 * Same-origin and non-browser callers (curl, fpm CLI, server-to-server) send
 * no `Origin` header at all — those get no CORS headers, which is correct and
 * costs nothing.
 */
export function corsHeaders(request: Request, env: CorsEnv): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin) return {};

  const allow = allowedOrigins(env);
  if (!allow.has(origin)) {
    // Fail closed: no Access-Control-Allow-Origin means the browser blocks it.
    return { vary: "Origin" };
  }

  const headers: Record<string, string> = {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
  };

  // The frontend uses Bearer tokens in localStorage, not cookies, so we do not
  // need `Access-Control-Allow-Credentials`. Omitting it keeps the API safe
  // against CSRF: a browser will not attach credentials cross-origin.
  return headers;
}

/** Handle a CORS preflight. Returns a Response, or null if not a preflight. */
export function handlePreflight(request: Request, env: CorsEnv): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request, env),
      "content-length": "0",
    },
  });
}