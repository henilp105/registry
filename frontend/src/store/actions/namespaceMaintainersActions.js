import { post, getErrorMessage, isSuccessResponse } from "../utils";

// Action types
export const ADD_NAMESPACE_MAINTAINER_REQUEST = "ADD_NAMESPACE_MAINTAINER_REQUEST";
export const ADD_NAMESPACE_MAINTAINER_SUCCESS = "ADD_NAMESPACE_MAINTAINER_SUCCESS";
export const ADD_NAMESPACE_MAINTAINER_FAILURE = "ADD_NAMESPACE_MAINTAINER_FAILURE";

export const REMOVE_NAMESPACE_MAINTAINER_REQUEST = "REMOVE_NAMESPACE_MAINTAINER_REQUEST";
export const REMOVE_NAMESPACE_MAINTAINER_SUCCESS = "REMOVE_NAMESPACE_MAINTAINER_SUCCESS";
export const REMOVE_NAMESPACE_MAINTAINER_FAILURE = "REMOVE_NAMESPACE_MAINTAINER_FAILURE";

export const RESET_NAMESPACE_MAINTAINER_MESSAGES = "RESET_NAMESPACE_MAINTAINER_MESSAGES";

// Legacy alias
export const RESET_ERROR_MESSAGE = RESET_NAMESPACE_MAINTAINER_MESSAGES;

/**
 * Add a maintainer to a namespace
 * @param {Object} data - Maintainer data
 * @param {string} data.uuid - User UUID
 * @param {string} data.username_to_be_added - Username to add
 * @param {string} data.namespace - Namespace name
 * @param {string} username - Current user's username
 */
export const addNamespaceMaintainer = (data, username) => async (dispatch) => {
  dispatch({ type: ADD_NAMESPACE_MAINTAINER_REQUEST });

  try {
    const result = await post(`/${username}/namespace/maintainer`, {
      uuid: data.uuid,
      username: data.username_to_be_added,
      namespace: data.namespace,
    });

    if (isSuccessResponse(result)) {
      dispatch({
        type: ADD_NAMESPACE_MAINTAINER_SUCCESS,
        payload: { message: result.data.message },
      });
    } else {
      dispatch({
        type: ADD_NAMESPACE_MAINTAINER_FAILURE,
        payload: { message: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: ADD_NAMESPACE_MAINTAINER_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Remove a maintainer from a namespace
 * @param {Object} data - Maintainer data
 * @param {string} data.uuid - User UUID
 * @param {string} data.username_to_be_removed - Username to remove
 * @param {string} data.namespace - Namespace name
 * @param {string} username - Current user's username
 */
export const removeNamespaceMaintainer = (data, username) => async (dispatch) => {
  dispatch({ type: REMOVE_NAMESPACE_MAINTAINER_REQUEST });

  try {
    const result = await post(`/${username}/namespace/maintainer/remove`, {
      uuid: data.uuid,
      username: data.username_to_be_removed,
      namespace: data.namespace,
    });

    if (isSuccessResponse(result)) {
      dispatch({
        type: REMOVE_NAMESPACE_MAINTAINER_SUCCESS,
        payload: { message: result.data.message },
      });
    } else {
      dispatch({
        type: REMOVE_NAMESPACE_MAINTAINER_FAILURE,
        payload: { message: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: REMOVE_NAMESPACE_MAINTAINER_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Reset namespace maintainer messages
 */
export const resetMessages = () => ({
  type: RESET_NAMESPACE_MAINTAINER_MESSAGES,
});
