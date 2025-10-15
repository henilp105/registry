import { post, getErrorMessage, isSuccessResponse } from "../utils";

// Action types
export const FORGOT_PASSWORD_REQUEST = "FORGOT_PASSWORD_REQUEST";
export const FORGOT_PASSWORD_SUCCESS = "FORGOT_PASSWORD_SUCCESS";
export const FORGOT_PASSWORD_FAILURE = "FORGOT_PASSWORD_FAILURE";

export const RESET_PASSWORD_REQUEST = "RESET_PASSWORD_REQUEST";
export const RESET_PASSWORD_SUCCESS = "RESET_PASSWORD_SUCCESS";
export const RESET_PASSWORD_FAILURE = "RESET_PASSWORD_FAILURE";

// Legacy aliases for backward compatibility
export const RESET_REQUEST = FORGOT_PASSWORD_REQUEST;
export const RESET_REQUEST_SUCCESS = FORGOT_PASSWORD_SUCCESS;
export const RESET_REQUEST_FAILURE = FORGOT_PASSWORD_FAILURE;
export const RESET_PASSWORD = RESET_PASSWORD_REQUEST;
export const RESET_SUCCESS = RESET_PASSWORD_SUCCESS;
export const RESET_FAILURE = RESET_PASSWORD_FAILURE;

/**
 * Request password reset email
 * @param {string} email - User email address
 */
export const forgot = (email) => async (dispatch) => {
  dispatch({ type: FORGOT_PASSWORD_REQUEST });

  try {
    const result = await post("/auth/forgot-password", { email });

    if (isSuccessResponse(result)) {
      dispatch({
        type: FORGOT_PASSWORD_SUCCESS,
        payload: {
          statuscode: result.data.code,
          message: result.data.message,
        },
      });
    } else {
      dispatch({
        type: FORGOT_PASSWORD_FAILURE,
        payload: {
          statuscode: result.data.code,
          message: result.data.message,
        },
      });
    }
  } catch (error) {
    dispatch({
      type: FORGOT_PASSWORD_FAILURE,
      payload: {
        statuscode: error.response?.data?.code || 500,
        message: getErrorMessage(error),
      },
    });
  }
};

/**
 * Reset password with token
 * @param {string} password - New password
 * @param {string} uuid - Reset token UUID
 */
export const reset = (password, uuid) => async (dispatch) => {
  dispatch({ type: RESET_PASSWORD_REQUEST });

  try {
    const result = await post("/auth/reset-password", { password, uuid });

    if (isSuccessResponse(result)) {
      dispatch({
        type: RESET_PASSWORD_SUCCESS,
        payload: {
          statuscode: result.data.code,
          message: result.data.message,
        },
      });
    } else {
      dispatch({
        type: RESET_PASSWORD_FAILURE,
        payload: {
          statuscode: result.data.code,
          message: result.data.message,
        },
      });
    }
  } catch (error) {
    dispatch({
      type: RESET_PASSWORD_FAILURE,
      payload: {
        statuscode: error.response?.data?.code || 500,
        message: getErrorMessage(error),
      },
    });
  }
};
