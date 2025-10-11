import { post, getErrorMessage, isSuccessResponse } from "../utils";

// Action types
export const ADD_NAMESPACE_ADMIN_REQUEST = "ADD_NAMESPACE_ADMIN_REQUEST";
export const ADD_NAMESPACE_ADMIN_SUCCESS = "ADD_NAMESPACE_ADMIN_SUCCESS";
export const ADD_NAMESPACE_ADMIN_FAILURE = "ADD_NAMESPACE_ADMIN_FAILURE";

export const REMOVE_NAMESPACE_ADMIN_REQUEST = "REMOVE_NAMESPACE_ADMIN_REQUEST";
export const REMOVE_NAMESPACE_ADMIN_SUCCESS = "REMOVE_NAMESPACE_ADMIN_SUCCESS";
export const REMOVE_NAMESPACE_ADMIN_FAILURE = "REMOVE_NAMESPACE_ADMIN_FAILURE";

export const RESET_NAMESPACE_ADMIN_MESSAGES = "RESET_NAMESPACE_ADMIN_MESSAGES";

// Legacy alias
export const RESET_ERROR_MESSAGE = RESET_NAMESPACE_ADMIN_MESSAGES;

/**
 * Add an admin to a namespace
 * @param {Object} data - Admin data
 * @param {string} data.uuid - User UUID
 * @param {string} data.username_to_be_added - Username to add as admin
 * @param {string} data.namespace - Namespace name
 * @param {string} username - Current user's username
 */
export const addNamespaceAdmin = (data, username) => async (dispatch) => {
  dispatch({ type: ADD_NAMESPACE_ADMIN_REQUEST });

  try {
    const result = await post(`/${username}/namespace/admin`, {
      uuid: data.uuid,
      username: data.username_to_be_added,
      namespace: data.namespace,
    });

    if (isSuccessResponse(result)) {
      dispatch({
        type: ADD_NAMESPACE_ADMIN_SUCCESS,
        payload: { message: result.data.message },
      });
    } else {
      dispatch({
        type: ADD_NAMESPACE_ADMIN_FAILURE,
        payload: { message: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: ADD_NAMESPACE_ADMIN_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Remove an admin from a namespace
 * @param {Object} data - Admin data
 * @param {string} data.uuid - User UUID
 * @param {string} data.username_to_be_removed - Username to remove as admin
 * @param {string} data.namespace - Namespace name
 * @param {string} username - Current user's username
 */
export const removeNamespaceAdmin = (data, username) => async (dispatch) => {
  dispatch({ type: REMOVE_NAMESPACE_ADMIN_REQUEST });

  try {
    const result = await post(`/${username}/namespace/admin/remove`, {
      uuid: data.uuid,
      username: data.username_to_be_removed,
      namespace: data.namespace,
    });

    if (isSuccessResponse(result)) {
      dispatch({
        type: REMOVE_NAMESPACE_ADMIN_SUCCESS,
        payload: { message: result.data.message },
      });
    } else {
      dispatch({
        type: REMOVE_NAMESPACE_ADMIN_FAILURE,
        payload: { message: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: REMOVE_NAMESPACE_ADMIN_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Reset namespace admin messages
 */
export const resetMessages = () => ({
  type: RESET_NAMESPACE_ADMIN_MESSAGES,
});
