import { authenticatedPost, getErrorMessage } from "../utils";

// Action types with consistent naming
export const REPORT_PACKAGE_REQUEST = "REPORT_PACKAGE_REQUEST";
export const REPORT_PACKAGE_SUCCESS = "REPORT_PACKAGE_SUCCESS";
export const REPORT_PACKAGE_FAILURE = "REPORT_PACKAGE_FAILURE";
export const RESET_REPORT_PACKAGE_MESSAGES = "RESET_REPORT_PACKAGE_MESSAGES";

// Legacy alias for backward compatibility
export const RESET_ERROR_MESSAGE = RESET_REPORT_PACKAGE_MESSAGES;

/**
 * Report a package as malicious/problematic
 * @param {Object} data - Report data
 * @param {string} data.reason - Report reason
 * @param {string} data.package - Package name
 * @param {string} data.namespace - Namespace name
 * @param {string} accessToken - User access token
 * @returns {Function} Redux thunk action
 */
export const reportPackage = (data, accessToken) => async (dispatch) => {
  dispatch({ type: REPORT_PACKAGE_REQUEST });

  try {
    const result = await authenticatedPost(
      `/report/${data.namespace}/${data.package}`,
      { reason: data.reason },
      accessToken
    );

    dispatch({
      type: REPORT_PACKAGE_SUCCESS,
      payload: {
        message: result.data.message,
        statuscode: result.data.code,
      },
    });
  } catch (error) {
    dispatch({
      type: REPORT_PACKAGE_FAILURE,
      payload: {
        message: getErrorMessage(error),
        statuscode: error.response?.data?.code,
      },
    });
  }
};

/**
 * Reset report package messages
 * @returns {Function} Redux thunk action
 */
export const resetErrorMessage = () => (dispatch) => {
  dispatch({ type: RESET_REPORT_PACKAGE_MESSAGES });
};
