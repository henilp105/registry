import { authenticatedPost, getErrorMessage } from "../utils";

// Action types - using consistent _REQUEST/_SUCCESS/_FAILURE naming
export const GET_USER_ACCOUNT_REQUEST = "GET_USER_ACCOUNT_REQUEST";
export const GET_USER_ACCOUNT_SUCCESS = "GET_USER_ACCOUNT_SUCCESS";
export const GET_USER_ACCOUNT_FAILURE = "GET_USER_ACCOUNT_FAILURE";

export const RESET_PASSWORD_REQUEST = "RESET_PASSWORD_REQUEST";
export const RESET_PASSWORD_SUCCESS = "RESET_PASSWORD_SUCCESS";
export const RESET_PASSWORD_FAILURE = "RESET_PASSWORD_FAILURE";

export const CHANGE_EMAIL_REQUEST = "CHANGE_EMAIL_REQUEST";
export const CHANGE_EMAIL_SUCCESS = "CHANGE_EMAIL_SUCCESS";
export const CHANGE_EMAIL_FAILURE = "CHANGE_EMAIL_FAILURE";

export const RESET_MESSAGES = "RESET_MESSAGES";

// Legacy aliases for backward compatibility
export const GET_USER_ACCOUNT = GET_USER_ACCOUNT_SUCCESS;
export const RESET_PASSWORD = RESET_PASSWORD_REQUEST;
export const RESET_PASSWORD_ERROR = RESET_PASSWORD_FAILURE;
export const CHANGE_EMAIL = CHANGE_EMAIL_REQUEST;

/**
 * Fetch user account details
 * @param {string} accessToken - JWT access token
 */
export const getUserAccount = (accessToken) => async (dispatch) => {
  dispatch({ type: GET_USER_ACCOUNT_REQUEST });

  try {
    const result = await authenticatedPost("/users/account", { accessToken }, accessToken);
    
    dispatch({
      type: GET_USER_ACCOUNT_SUCCESS,
      payload: {
        email: result.data.user.email,
        dateJoined: result.data.user.createdAt.slice(0, 16),
      },
    });
  } catch (error) {
    dispatch({
      type: GET_USER_ACCOUNT_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Reset user password
 * @param {string} oldPassword - Current password
 * @param {string} newPassword - New password
 * @param {string} accessToken - JWT access token
 */
export const reset = (oldPassword, newPassword, accessToken) => async (dispatch) => {
  dispatch({ type: RESET_PASSWORD_REQUEST });

  try {
    const result = await authenticatedPost(
      "/auth/reset-password",
      { oldpassword: oldPassword, password: newPassword, uuid: accessToken },
      accessToken
    );
    
    dispatch({
      type: RESET_PASSWORD_SUCCESS,
      payload: { message: result.data.message },
    });
  } catch (error) {
    dispatch({
      type: RESET_PASSWORD_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Change user email address
 * @param {string} newEmail - New email address
 * @param {string} accessToken - JWT access token
 */
export const change = (newEmail, accessToken) => async (dispatch) => {
  dispatch({ type: CHANGE_EMAIL_REQUEST });

  try {
    const result = await authenticatedPost(
      "/auth/change-email",
      { new_email: newEmail, accessToken },
      accessToken
    );
    
    dispatch({
      type: CHANGE_EMAIL_SUCCESS,
      payload: { message: result.data.message },
    });
  } catch (error) {
    dispatch({
      type: CHANGE_EMAIL_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};

/**
 * Reset all account messages and errors
 */
export const resetMessages = () => ({
  type: RESET_MESSAGES,
});
