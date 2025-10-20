import { authenticatedPost, getErrorMessage } from "../utils";

// Action types with consistent naming
export const RATE_PACKAGE_REQUEST = "RATE_PACKAGE_REQUEST";
export const RATE_PACKAGE_SUCCESS = "RATE_PACKAGE_SUCCESS";
export const RATE_PACKAGE_FAILURE = "RATE_PACKAGE_FAILURE";
export const RESET_RATE_PACKAGE_MESSAGES = "RESET_RATE_PACKAGE_MESSAGES";

// Legacy alias for backward compatibility
export const RESET_ERROR_MESSAGE = RESET_RATE_PACKAGE_MESSAGES;

/**
 * Rate a package
 * @param {Object} data - Rating data
 * @param {number} data.rating - Rating value
 * @param {string} data.package - Package name
 * @param {string} data.namespace - Namespace name
 * @param {string|null} accessToken - User access token
 * @returns {Function} Redux thunk action
 */
export const ratePackage = (data, accessToken) => async (dispatch) => {
  // Exit early if no access token
  if (accessToken === null) {
    dispatch({
      type: RATE_PACKAGE_FAILURE,
      payload: {
        message: "Unauthorized to rate packages. Please login to rate packages.",
        statuscode: "403",
      },
    });
    return;
  }

  dispatch({ type: RATE_PACKAGE_REQUEST });

  try {
    const result = await authenticatedPost(
      `/ratings/${data.namespace}/${data.package}`,
      { rating: data.rating },
      accessToken
    );

    dispatch({
      type: RATE_PACKAGE_SUCCESS,
      payload: {
        message: result.data.message,
        statuscode: result.data.code,
      },
    });
  } catch (error) {
    dispatch({
      type: RATE_PACKAGE_FAILURE,
      payload: {
        message: getErrorMessage(error),
        statuscode: error.response?.data?.code,
      },
    });
  }
};

/**
 * Reset rate package messages
 * @returns {Function} Redux thunk action
 */
export const resetErrorMessage = () => (dispatch) => {
  dispatch({ type: RESET_RATE_PACKAGE_MESSAGES });
};
