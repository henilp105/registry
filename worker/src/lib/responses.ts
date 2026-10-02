/**
 * Response envelope helpers.
 *
 * The frozen contract (docs/API_CONTRACT.md §1) requires:
 *   - success  => HTTP 2xx  AND body containing `code: 200`
 *   - failure  => HTTP non-2xx AND body `{ code, message }`
 *
 * 45 frontend call sites branch on `result.data.code === 200`, and 29 read
 * `error.response.data.message`. Getting this wrong silently breaks the UI.
 *
 * Defect D14/D16 in docs/BASELINE_AUDIT.md: the Flask app has nine error
 * paths that return HTTP 200 with a non-200 `code` in the body (including a
 * 401 and several 404s). We fix that here — it can only make the client
 * more correct, since the frontend already reads `code`.
 */

export type Envelope = {
  code: number;
  message: string;
  [key: string]: unknown;
};

/**
 * Body shape accepted by `jsonOk` / `jsonError`.
 *
 * `code` is deliberately absent: these helpers *supply* it, and letting a
 * caller also pass one is how the HTTP status and the body `code` drift apart
 * — which is exactly defect D14 in the Flask app, where nine error paths
 * returned HTTP 200 with a 401/404/500 in the body.
 */
export type BodyWithoutCode = Record<string, unknown> & { message?: string };

/** Successful response. Always `code: 200` plus the given fields. */
export function ok(data: Record<string, unknown> = {}, message = ""): Envelope {
  return { code: 200, message, ...data };
}

/**
 * Error response. The HTTP status and the body `code` are always kept in
 * sync, which is the whole point of D14.
 */
export function fail(status: number, message: string, extra: Record<string, unknown> = {}): Envelope {
  return { code: status, message, ...extra };
}

/** Serialise an envelope to a `Response` with the correct HTTP status. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...headers,
    },
  });
}

export function jsonOk(body: BodyWithoutCode = {}, headers?: Record<string, string>): Response {
  return json(200, { code: 200, ...body }, headers);
}

export function jsonError(
  status: number,
  message: string,
  extra: Record<string, unknown> = {},
  headers?: Record<string, string>,
): Response {
  return json(status, { code: status, message, ...extra }, headers);
}

/**
 * A refusal for someone who *is* authenticated but is not allowed to do this.
 *
 * ── Why this is not a 403 ────────────────────────────────────────────────────
 * The status stays **401**. `v2.0.1` answered every authorisation failure with
 * 401, `docs/API_CONTRACT.md` froze that, and `scripts/check_api_compat.py`
 * enforces it. Changing the status would break every existing client for no gain:
 * the information the client actually needs is *which kind* of 401 this is, and
 * that fits in the body.
 *
 * ── Why the distinction is load-bearing ─────────────────────────────────────
 * Defect D65. The frontend ends the session on any 401 that arrived on a request
 * carrying an `Authorization` header, reasoning that an unauthenticated caller
 * would not have sent one. That reasoning is wrong, because the API also answers
 * **401 to authenticated callers who simply lack the permission** -- a non-admin
 * probing `POST /users/admin` is the common case.
 *
 * So every non-admin was logged out within a second of logging in: the navbar
 * probes for admin rights immediately after sign-in, that probe returns 401, and
 * the interceptor concluded the token had expired. Nobody could stay signed in
 * except an admin. The same trap waited at every permission check -- deleting
 * someone else's package, removing a namespace maintainer -- each of which is a
 * normal thing for a signed-in user to attempt and be refused.
 *
 * `reason: "forbidden"` lets the client tell "your session is over" from "you
 * may not do that" without guessing. It is additive: a client that does not know
 * the field behaves exactly as before.
 */
export function jsonForbidden(message = "Unauthorized"): Response {
  return jsonError(401, message, { reason: "forbidden" });
}

/**
 * Security headers. Ports the v2.0.1 `after_request` hook so behaviour is
 * preserved across the migration.
 */
export function securityHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-xss-protection": "0",
  };
}