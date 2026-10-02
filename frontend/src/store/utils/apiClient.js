import axios from "axios";
import { getAccessToken, emitUnauthorized } from "./session";

/**
 * Configured Axios instance for API calls
 * Centralizes API configuration and error handling
 */
const apiClient = axios.create({
  baseURL: process.env.REACT_APP_REGISTRY_API_URL,
  headers: {
    "Content-Type": "multipart/form-data",
  },
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
 * End the session on 401.
 *
 * There is no refresh endpoint on the backend, so an expired or revoked access
 * token cannot be renewed. Only responses to requests that actually carried a
 * token are treated as session expiry - this deliberately excludes 401s from
 * endpoints that reject anonymous callers (e.g. a wrong password on
 * `POST /auth/login`), which must surface their own error message.
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const sentToken = error?.config?.headers?.Authorization;
    if (status === 401 && sentToken) {
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
