import { post, authenticatedPost, getErrorMessage, isSuccessResponse } from "../utils";
import apiClient from "../utils/apiClient";

// Action types - using consistent _REQUEST/_SUCCESS/_FAILURE naming
export const ADMIN_AUTH_REQUEST = "ADMIN_AUTH_REQUEST";
export const ADMIN_AUTH_SUCCESS = "ADMIN_AUTH_SUCCESS";
export const ADMIN_AUTH_FAILURE = "ADMIN_AUTH_FAILURE";

export const DELETE_USER_REQUEST = "DELETE_USER_REQUEST";
export const DELETE_USER_SUCCESS = "DELETE_USER_SUCCESS";
export const DELETE_USER_FAILURE = "DELETE_USER_FAILURE";

export const DELETE_NAMESPACE_REQUEST = "DELETE_NAMESPACE_REQUEST";
export const DELETE_NAMESPACE_SUCCESS = "DELETE_NAMESPACE_SUCCESS";
export const DELETE_NAMESPACE_FAILURE = "DELETE_NAMESPACE_FAILURE";

export const DELETE_PACKAGE_REQUEST = "DELETE_PACKAGE_REQUEST";
export const DELETE_PACKAGE_SUCCESS = "DELETE_PACKAGE_SUCCESS";
export const DELETE_PACKAGE_FAILURE = "DELETE_PACKAGE_FAILURE";

export const DELETE_RELEASE_REQUEST = "DELETE_RELEASE_REQUEST";
export const DELETE_RELEASE_SUCCESS = "DELETE_RELEASE_SUCCESS";
export const DELETE_RELEASE_FAILURE = "DELETE_RELEASE_FAILURE";

export const DEPRECATE_PACKAGE_REQUEST = "DEPRECATE_PACKAGE_REQUEST";
export const DEPRECATE_PACKAGE_SUCCESS = "DEPRECATE_PACKAGE_SUCCESS";
export const DEPRECATE_PACKAGE_FAILURE = "DEPRECATE_PACKAGE_FAILURE";

export const RESET_ADMIN_MESSAGES = "RESET_ADMIN_MESSAGES";

// Legacy aliases for backward compatibility
export const ADMIN_AUTH_ERROR = ADMIN_AUTH_FAILURE;
export const DELETE_USER_ERROR = DELETE_USER_FAILURE;
export const DELETE_NAMESPACE_ERROR = DELETE_NAMESPACE_FAILURE;
export const DELETE_PACKAGE_ERROR = DELETE_PACKAGE_FAILURE;
export const DELETE_RELEASE_ERROR = DELETE_RELEASE_FAILURE;
export const DEPRECATE_PACKAGE_ERROR = DEPRECATE_PACKAGE_FAILURE;

/**
 * Helper to create admin action payload
 *
 * `deleteRelease` is the one endpoint that answers 2xx without a `code` key in
 * the body, so fall back to the HTTP status in that case. `admin.js` derives
 * the alert colour from `statuscode`, and `undefined >= 200` would paint a
 * successful delete as a failure.
 */
const createPayload = (response) => ({
  statuscode: response.data?.code ?? response.status,
  message: response.data?.message,
});

/**
 * Helper to create error payload
 */
const createErrorPayload = (error) => ({
  statuscode: error.response?.data?.code || 500,
  message: getErrorMessage(error),
});

/**
 * Authenticate admin user
 * @param {string} accessToken - JWT access token
 */
export const adminAuth = (accessToken) => async (dispatch) => {
  dispatch({ type: ADMIN_AUTH_REQUEST });

  try {
    const result = await authenticatedPost("/users/admin", {}, accessToken);

    if (isSuccessResponse(result)) {
      dispatch({
        type: ADMIN_AUTH_SUCCESS,
        payload: createPayload(result),
      });
    } else {
      dispatch({
        type: ADMIN_AUTH_FAILURE,
        payload: createPayload(result),
      });
    }
  } catch (error) {
    dispatch({
      type: ADMIN_AUTH_FAILURE,
      payload: createErrorPayload(error),
    });
  }
};

/**
 * Delete a user (admin action)
 * @param {string} username - Username to delete
 */
export const deleteUser = (username) => async (dispatch) => {
  dispatch({ type: DELETE_USER_REQUEST });

  try {
    const result = await post("/users/delete", { username });

    if (isSuccessResponse(result)) {
      dispatch({
        type: DELETE_USER_SUCCESS,
        payload: createPayload(result),
      });
    } else {
      dispatch({
        type: DELETE_USER_FAILURE,
        payload: createPayload(result),
      });
    }
  } catch (error) {
    dispatch({
      type: DELETE_USER_FAILURE,
      payload: createErrorPayload(error),
    });
  }
};

/**
 * Delete a namespace (admin action)
 * @param {string} namespace - Namespace to delete
 */
export const deleteNamespace = (namespace) => async (dispatch) => {
  dispatch({ type: DELETE_NAMESPACE_REQUEST });

  try {
    const result = await post(`/namespace/${namespace}/delete`);

    if (isSuccessResponse(result)) {
      dispatch({
        type: DELETE_NAMESPACE_SUCCESS,
        payload: createPayload(result),
      });
    } else {
      dispatch({
        type: DELETE_NAMESPACE_FAILURE,
        payload: createPayload(result),
      });
    }
  } catch (error) {
    dispatch({
      type: DELETE_NAMESPACE_FAILURE,
      payload: createErrorPayload(error),
    });
  }
};

/**
 * Delete a package (admin action)
 * @param {string} namespaceName - Namespace name
 * @param {string} packageName - Package name
 */
export const deletePackage = (namespaceName, packageName) => async (dispatch) => {
  dispatch({ type: DELETE_PACKAGE_REQUEST });

  try {
    const result = await post(`/packages/${namespaceName}/${packageName}/delete`);

    if (isSuccessResponse(result)) {
      dispatch({
        type: DELETE_PACKAGE_SUCCESS,
        payload: createPayload(result),
      });
    } else {
      dispatch({
        type: DELETE_PACKAGE_FAILURE,
        payload: createPayload(result),
      });
    }
  } catch (error) {
    dispatch({
      type: DELETE_PACKAGE_FAILURE,
      payload: createErrorPayload(error),
    });
  }
};

/**
 * Delete a package release (admin action)
 * @param {string} namespaceName - Namespace name
 * @param {string} packageName - Package name
 * @param {string} version - Version to delete
 */
export const deleteRelease = (namespaceName, packageName, version) => async (dispatch) => {
  dispatch({ type: DELETE_RELEASE_REQUEST });

  try {
    const result = await post(`/packages/${namespaceName}/${packageName}/${version}/delete`);

    // POST /packages/{ns}/{pkg}/{ver}/delete answers 200 with a bare
    // `{ message }` and no `code` key, so `isSuccessResponse` would report a
    // failure even when the release was actually deleted. Accept any 2xx here
    // rather than loosening `isSuccessResponse` for the other 45 call sites
    // that legitimately branch on `code === 200`.
    if (result.status >= 200 && result.status < 300) {
      dispatch({
        type: DELETE_RELEASE_SUCCESS,
        payload: createPayload(result),
      });
    } else {
      dispatch({
        type: DELETE_RELEASE_FAILURE,
        payload: createPayload(result),
      });
    }
  } catch (error) {
    dispatch({
      type: DELETE_RELEASE_FAILURE,
      payload: createErrorPayload(error),
    });
  }
};

/**
 * Deprecate a package (admin action)
 * @param {string} namespaceName - Namespace name
 * @param {string} packageName - Package name
 */
export const deprecatePackage = (namespaceName, packageName) => async (dispatch) => {
  dispatch({ type: DEPRECATE_PACKAGE_REQUEST });

  try {
    const formData = new FormData();
    formData.append("name", packageName);
    formData.append("namespace", namespaceName);
    formData.append("isDeprecated", "true");

    const result = await apiClient.put("/packages", formData);

    if (isSuccessResponse(result)) {
      dispatch({
        type: DEPRECATE_PACKAGE_SUCCESS,
        payload: createPayload(result),
      });
    } else {
      dispatch({
        type: DEPRECATE_PACKAGE_FAILURE,
        payload: createPayload(result),
      });
    }
  } catch (error) {
    dispatch({
      type: DEPRECATE_PACKAGE_FAILURE,
      payload: createErrorPayload(error),
    });
  }
};

/**
 * Reset admin messages and status
 */
export const resetAdminMessages = () => ({
  type: RESET_ADMIN_MESSAGES,
});
