import { post, getErrorMessage, isSuccessResponse } from "../utils";

// Action types with consistent naming
export const VERIFY_EMAIL_REQUEST = "VERIFY_EMAIL_REQUEST";
export const VERIFY_EMAIL_SUCCESS = "VERIFY_EMAIL_SUCCESS";
export const VERIFY_EMAIL_FAILURE = "VERIFY_EMAIL_FAILURE";

// Legacy aliases for backward compatibility
export const VERIFY_REQUEST = VERIFY_EMAIL_REQUEST;
export const VERIFY_REQUEST_SUCCESS = VERIFY_EMAIL_SUCCESS;
export const VERIFY_REQUEST_FAILURE = VERIFY_EMAIL_FAILURE;

/**
 * Verify user email
 * @param {string} uuid - User UUID
 * @returns {Function} Redux thunk action
 */
export const verify = (uuid) => async (dispatch) => {
  dispatch({ type: VERIFY_EMAIL_REQUEST });

  try {
    const result = await post("/auth/verify-email", { uuid });

    if (isSuccessResponse(result)) {
      dispatch({
        type: VERIFY_EMAIL_SUCCESS,
        payload: {
          statuscode: result.data.code,
          message: result.data.message,
        },
      });
    } else {
      dispatch({
        type: VERIFY_EMAIL_FAILURE,
        payload: {
          statuscode: result.data.code,
          message: result.data.message,
        },
      });
    }
  } catch (error) {
    dispatch({
      type: VERIFY_EMAIL_FAILURE,
      payload: {
        statuscode: error.response?.data?.code,
        message: getErrorMessage(error),
      },
    });
  }
};
