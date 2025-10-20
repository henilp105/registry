import { authenticatedPost, getErrorMessage, isSuccessResponse } from "../utils";

// Action types with consistent naming
export const GENERATE_PACKAGE_TOKEN_REQUEST = "GENERATE_PACKAGE_TOKEN_REQUEST";
export const GENERATE_PACKAGE_TOKEN_SUCCESS = "GENERATE_PACKAGE_TOKEN_SUCCESS";
export const GENERATE_PACKAGE_TOKEN_FAILURE = "GENERATE_PACKAGE_TOKEN_FAILURE";
export const RESET_PACKAGE_TOKEN_MESSAGES = "RESET_PACKAGE_TOKEN_MESSAGES";

// Legacy aliases for backward compatibility (note: SUCESS was a typo)
export const GENERATE_PACKAGE_TOKEN_SUCESS = GENERATE_PACKAGE_TOKEN_SUCCESS;
export const RESET_MESSAGE = RESET_PACKAGE_TOKEN_MESSAGES;

/**
 * Generate an upload token for a package
 * @param {Object} data - Token generation data
 * @param {string} data.namespace - Namespace name
 * @param {string} data.package - Package name
 * @param {string} data.accessToken - User access token
 * @returns {Function} Redux thunk action
 */
export const generatePackageToken = (data) => async (dispatch) => {
  dispatch({ type: GENERATE_PACKAGE_TOKEN_REQUEST });

  try {
    const result = await authenticatedPost(
      `/packages/${data.namespace}/${data.package}/uploadToken`,
      {},
      data.accessToken
    );

    if (isSuccessResponse(result)) {
      dispatch({
        type: GENERATE_PACKAGE_TOKEN_SUCCESS,
        payload: {
          message: result.data.message,
          uploadToken: result.data.uploadToken,
        },
      });
    } else {
      dispatch({
        type: GENERATE_PACKAGE_TOKEN_FAILURE,
        payload: {
          message: result.data.message,
        },
      });
    }
  } catch (error) {
    dispatch({
      type: GENERATE_PACKAGE_TOKEN_FAILURE,
      payload: {
        message: getErrorMessage(error),
      },
    });
  }
};

/**
 * Reset package token generation messages
 * @returns {Function} Redux thunk action
 */
export const resetMessages = () => (dispatch) => {
  dispatch({ type: RESET_PACKAGE_TOKEN_MESSAGES });
};
