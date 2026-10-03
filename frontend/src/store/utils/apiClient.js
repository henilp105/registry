import axios from "axios";
import { getAccessToken, emitUnauthorized } from "./session";

/**
 * Configured Axios instance for API calls
 * Centralizes API configuration and error handling
 */
const apiClient = axios.create({
  baseURL: process.env.REACT_APP_REGISTRY_API_URL,
  // No blanket Content-Type: forcing "multipart/form-data" on GETs/JSON sends a
  // bogus header, and on FormData POSTs it can pin the header without the
  // boundary parameter, which makes request.formData() fail server-side.
  // Axios sets the right value per request (boundary included for FormData).
});

/**
 * Attach the current access token to every request.
 *
 * Fixes the defect described in docs/API_CONTRACT.md §4: ten moderator call
 * paths sent no `Authorization` header at all, and every one of those routes is
 * `@jwt_required()`, so they all returned 401. The backend resolves identity
 * from `get_jwt_identity()`, i.e. the header - the `uuid` form field those
 * routes used to send is never populated by any reducer.
 *
 * Requests that already set the header explicitly (`authenticatedPost`,
 * `logout`) are left alone.
 */
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * End the session on 401 -- but only when the session really is over.
 *
 * There is no refresh endpoint, so an expired or revoked token cannot be renewed
 * and signing out is the only correct response.
 *
 * Two kinds of 401 have to be told apart, and conflating them breaks login
 * entirely (defect D65):
 *
 *  - **The token is no longer accepted.** Sign out.
 *  - **The token was fine, you just may not do that.** The API answers 401 here
 *    too, and has done so since `v2.0.1` -- changing it to 403 would break every
 *    existing client and the frozen contract. So a non-admin probing
 *    `POST /users/admin`, a maintainer deleting a package they do not own, a
 *    user removing a namespace maintainer: all 401, all with a perfectly valid
 *    session.
 *
 * The old guard was "401 on a request that carried a token", reasoning that an
 * anonymous caller would not have sent one. That reasoning is false for exactly
 * the cases above, and the navbar probes for admin rights immediately after
 * sign-in -- so **every non-admin was logged out about a second after logging
 * in**, and nobody but an admin could stay signed in at all.
 *
 * The backend now sends `reason: "forbidden"` on the second kind. A client that
 * does not know the field is unaffected; this one uses it.
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const sentToken = error?.config?.headers?.Authorization;
    const isForbidden = error?.response?.data?.reason === "forbidden";

    // Credential-validation endpoints return 401 for bad input (wrong password,
    // expired verify/reset token), not because the session ended. An anonymous
    // caller here carries no token and never logged out; a still-logged-in user
    // who clicks an old verify/reset link would previously lose their session.
    const PUBLIC_401_PATHS = [
      "/auth/login",
      "/auth/signup",
      "/auth/verify-email",
      "/auth/reset-password",
      "/auth/forgot-password",
      "/auth/refresh",
    ];
    const requestUrl = String(error?.config?.url ?? "");
    const isPublic401 = PUBLIC_401_PATHS.some((p) => requestUrl.includes(p));

    if (status === 401 && sentToken && !isForbidden && !isPublic401) {
      emitUnauthorized();
    }
    return Promise.reject(error);
  }
);

/**
 * Create FormData from an object
 * @param {Object} data - Key-value pairs to add to FormData
 * @returns {FormData}
 */
export const createFormData = (data) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, value);
    }
  });
  return formData;
};

/**
 * Make an authenticated POST request
 * @param {string} url - API endpoint
 * @param {Object} data - Request body data
 * @param {string} accessToken - JWT access token
 * @returns {Promise}
 */
export const authenticatedPost = (url, data = {}, accessToken) => {
  const formData = createFormData(data);
  return apiClient.post(url, formData, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
};

/**
 * Make an unauthenticated POST request
 * @param {string} url - API endpoint
 * @param {Object} data - Request body data
 * @returns {Promise}
 */
export const post = (url, data = {}) => {
  const formData = createFormData(data);
  return apiClient.post(url, formData);
};

/**
 * Make a GET request
 * @param {string} url - API endpoint
 * @param {Object} params - Query parameters
 * @returns {Promise}
 */
export const get = (url, params = {}) => {
  return apiClient.get(url, { params });
};

/**
 * Extract error message from API error response
 * @param {Error} error - Axios error object
 * @returns {string} Error message
 */
export const getErrorMessage = (error) => {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  if (error.message) {
    return error.message;
  }
  return "An unexpected error occurred";
};

/**
 * Check if API response indicates success
 * @param {Object} response - Axios response object
 * @returns {boolean}
 */
export const isSuccessResponse = (response) => {
  return response.data?.code === 200;
};

export default apiClient;
