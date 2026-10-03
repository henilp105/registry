/**
 * Module-scoped view of the authenticated session.
 *
 * The axios instance needs the current access token on *every* request, but
 * importing the Redux store from `store/utils/` would create an import cycle
 * (`store` -> reducers -> actions -> utils -> store`). Instead the store is
 * mirrored here by `<SessionGuard />` (see `src/components/SessionGuard.js`),
 * which keeps this module in sync with `state.auth.accessToken` after
 * redux-persist rehydration as well as on login/logout.
 *
 * Backend note (docs/API_CONTRACT.md §4): the moderator routes resolve identity
 * from `Authorization: Bearer <access_token>` via `get_jwt_identity()`. The
 * `uuid` form field those call sites used to send was never populated by any
 * reducer, so the header is the only thing that actually authenticates them.
 */

let accessToken = null;
let refreshToken = null;
let onUnauthorized = null;
let onTokensRefreshed = null;

/**
 * Set (or clear) the token used for outgoing requests.
 * @param {string|null} token - JWT access token, or null to clear
 */
export const setAccessToken = (token) => {
  accessToken = token || null;
};

/**
 * @returns {string|null} The current JWT access token
 */
export const getAccessToken = () => accessToken;

/**
 * Set (or clear) the refresh token used to renew the access token.
 * @param {string|null} token - JWT refresh token, or null to clear
 */
export const setRefreshToken = (token) => {
  refreshToken = token || null;
};

/**
 * @returns {string|null} The current refresh token
 */
export const getRefreshToken = () => refreshToken;

/**
 * Register a callback invoked when a token refresh succeeds, so the new token
 * pair can be mirrored back into the Redux store.
 * @param {Function} handler - Called with ({accessToken, refreshToken})
 */
export const setTokensRefreshedHandler = (handler) => {
  onTokensRefreshed = typeof handler === "function" ? handler : null;
};

/**
 * Notify the registered handler (if any) that the token pair was renewed.
 */
export const emitTokensRefreshed = (tokens) => {
  if (onTokensRefreshed) onTokensRefreshed(tokens);
};

/**
 * Register a callback invoked when the API rejects a request we sent with an
 * access token, even after a refresh attempt (i.e. the session is over).
 * @param {Function} handler - Called with no arguments
 */
export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = typeof handler === "function" ? handler : null;
};

/**
 * Notify the registered handler (if any) that a 401 ended the session.
 */
export const emitUnauthorized = () => {
  if (onUnauthorized) onUnauthorized();
};
