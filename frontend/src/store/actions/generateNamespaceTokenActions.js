import { authenticatedPost, getErrorMessage, isSuccessResponse } from "../utils";

// Action types with consistent naming
export const GENERATE_NAMESPACE_TOKEN_REQUEST = "GENERATE_NAMESPACE_TOKEN_REQUEST";
export const GENERATE_NAMESPACE_TOKEN_SUCCESS = "GENERATE_NAMESPACE_TOKEN_SUCCESS";
export const GENERATE_NAMESPACE_TOKEN_FAILURE = "GENERATE_NAMESPACE_TOKEN_FAILURE";
export const RESET_NAMESPACE_TOKEN_MESSAGES = "RESET_NAMESPACE_TOKEN_MESSAGES";

// Legacy aliases for backward compatibility
export const GENERATE_TOKEN_REQUEST = GENERATE_NAMESPACE_TOKEN_REQUEST;
export const GENERATE_TOKEN_SUCCESS = GENERATE_NAMESPACE_TOKEN_SUCCESS;
export const GENERATE_TOKEN_FAILURE = GENERATE_NAMESPACE_TOKEN_FAILURE;
export const RESET_MESSAGE = RESET_NAMESPACE_TOKEN_MESSAGES;

/**
 * Generate an upload token for a namespace
 * @param {Object} data - Token generation data
 * @param {string} data.namespace - Namespace name
 * @param {string} data.accessToken - User access token
 * @returns {Function} Redux thunk action
 */
export const generateToken = (data) => async (dispatch) => {
  dispatch({ type: GENERATE_NAMESPACE_TOKEN_REQUEST });

  try {
    const result = await authenticatedPost(
      `/namespaces/${data.namespace}/uploadToken`,
      { namespace: data.namespace },
      data.accessToken
    );

    if (isSuccessResponse(result)) {
      dispatch({
        type: GENERATE_NAMESPACE_TOKEN_SUCCESS,
        payload: {
          message: result.data.message,
          uploadToken: result.data.uploadToken,
        },
      });
    } else {
      dispatch({
        type: GENERATE_NAMESPACE_TOKEN_FAILURE,
        payload: {
          message: result.data.message,
        },
      });
    }
  } catch (error) {
    dispatch({
      type: GENERATE_NAMESPACE_TOKEN_FAILURE,
      payload: {
        message: getErrorMessage(error),
      },
    });
  }
};

/**
 * Reset namespace token generation messages
 * @returns {Function} Redux thunk action
 */
export const resetMessages = () => (dispatch) => {
  dispatch({ type: RESET_NAMESPACE_TOKEN_MESSAGES });
};
