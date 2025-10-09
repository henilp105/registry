import { post, getErrorMessage, isSuccessResponse } from "../utils";

// Action types
export const ADD_MAINTAINER_REQUEST = "ADD_MAINTAINER_REQUEST";
export const ADD_MAINTAINER_SUCCESS = "ADD_MAINTAINER_SUCCESS";
export const ADD_MAINTAINER_FAILURE = "ADD_MAINTAINER_FAILURE";

export const REMOVE_MAINTAINER_REQUEST = "REMOVE_MAINTAINER_REQUEST";
export const REMOVE_MAINTAINER_SUCCESS = "REMOVE_MAINTAINER_SUCCESS";
export const REMOVE_MAINTAINER_FAILURE = "REMOVE_MAINTAINER_FAILURE";

export const RESET_MAINTAINER_MESSAGES = "RESET_MAINTAINER_MESSAGES";

// Legacy alias for backward compatibility
export const RESET_MESSAGE = RESET_MAINTAINER_MESSAGES;

/**
 * Add a maintainer to a package
 * @param {Object} data - Maintainer data
 * @param {string} data.uuid - User UUID
 * @param {string} data.username_to_be_added - Username to add as maintainer
 * @param {string} data.namespace - Package namespace
 * @param {string} data.package - Package name
 * @param {string} username - Current user's username
 */
export const addMaintainer = (data, username) => async (dispatch) => {
  dispatch({ type: ADD_MAINTAINER_REQUEST });

  try {
    const result = await post(`/${username}/maintainer`, {
      uuid: data.uuid,
      username: data.username_to_be_added,
      namespace: data.namespace,
      package: data.package,
    });

    if (isSuccessResponse(result)) {
      dispatch({
        type: ADD_MAINTAINER_SUCCESS,
        payload: { message: result.data.message },
      });
    } else {
      dispatch({
        type: ADD_MAINTAINER_FAILURE,
        payload: { message: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: ADD_MAINTAINER_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Remove a maintainer from a package
 * @param {Object} data - Maintainer data
 * @param {string} data.uuid - User UUID
 * @param {string} data.username_to_be_removed - Username to remove as maintainer
 * @param {string} data.namespace - Package namespace
 * @param {string} data.package - Package name
 * @param {string} username - Current user's username
 */
export const removeMaintainer = (data, username) => async (dispatch) => {
  dispatch({ type: REMOVE_MAINTAINER_REQUEST });

  try {
    const result = await post(`/${username}/maintainer/remove`, {
      uuid: data.uuid,
      username: data.username_to_be_removed,
      namespace: data.namespace,
      package: data.package,
    });

    if (isSuccessResponse(result)) {
      dispatch({
        type: REMOVE_MAINTAINER_SUCCESS,
        payload: { message: result.data.message },
      });
    } else {
      dispatch({
        type: REMOVE_MAINTAINER_FAILURE,
        payload: { message: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: REMOVE_MAINTAINER_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Reset maintainer messages
 */
export const resetMessages = () => ({
  type: RESET_MAINTAINER_MESSAGES,
});
