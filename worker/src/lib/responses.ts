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

export function jsonOk(body: Envelope, headers?: Record<string, string>): Response {
  return json(200, body, headers);
}

export function jsonError(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json(status, fail(status, message, extra));
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