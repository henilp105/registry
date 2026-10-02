/**
 * Reducer helpers for normalising API responses.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Components read list fields straight out of the store without checking, and
 * several of them call `.length` or `.map` on them to render. So the reducer is
 * the only place where the shape can be guaranteed, and it has to be that place:
 * fixing it per component means N chances to forget one.
 *
 * Concretely, a 200 response whose `packages` is not an array produced
 * `TypeError: Cannot read properties of undefined (reading 'length')` and blanked
 * the page entirely. Reproduced by injecting a non-JSON body — which is what a
 * proxy error page, a truncated response or a captive portal looks like. A
 * registry that shows a blank page for that is worse than one that shows an
 * empty list.
 *
 * Note this is defence in depth, not the primary defence: `getErrorMessage` and
 * the catch blocks in the actions already handle genuine failures. This handles
 * the case where the request *succeeded* and the payload was still not what the
 * contract promised.
 */

/**
 * Return `value` if it is an array, otherwise `[]`.
 *
 * Used for every list field the API returns. Non-array input becomes an empty
 * list rather than propagating, because a list-shaped field that is not a list
 * is a rendering bug waiting to happen, and an empty list renders correctly.
 *
 * Plain JS, deliberately: this project has no TypeScript (0 `.ts` files against
 * 90 `.js`), and a `as T[]` cast here fails the build with a syntax error.
 */
export const asList = (value) => (Array.isArray(value) ? value : []);

/**
 * Return `value` if it is a string, otherwise `fallback`.
 *
 * For scalar fields, where `undefined` would otherwise reach the DOM as
 * `undefined` or crash a `.slice()`.
 */
export const asText = (value, fallback = "") => (typeof value === "string" ? value : fallback);
