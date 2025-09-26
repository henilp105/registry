import axios from "axios";

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
