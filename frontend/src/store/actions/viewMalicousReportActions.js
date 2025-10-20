import { apiClient, getErrorMessage } from "../utils";

// Action types with consistent naming
export const FETCH_MALICIOUS_REPORTS_REQUEST = "FETCH_MALICIOUS_REPORTS_REQUEST";
export const FETCH_MALICIOUS_REPORTS_SUCCESS = "FETCH_MALICIOUS_REPORTS_SUCCESS";
export const FETCH_MALICIOUS_REPORTS_FAILURE = "FETCH_MALICIOUS_REPORTS_FAILURE";
export const RESET_MALICIOUS_REPORTS_DATA = "RESET_MALICIOUS_REPORTS_DATA";

// Legacy aliases for backward compatibility
export const FETCH_MALICIOUS_REPORTS = FETCH_MALICIOUS_REPORTS_REQUEST;
export const FETCH_MALICIOUS_REPORTS_ERROR = FETCH_MALICIOUS_REPORTS_FAILURE;
export const RESET_DATA = RESET_MALICIOUS_REPORTS_DATA;

/**
 * Fetch malicious package reports (admin only)
 * @param {string} accessToken - User access token
 * @returns {Function} Redux thunk action
 */
export const fetchMalicousReports = (accessToken) => async (dispatch) => {
  dispatch({ type: FETCH_MALICIOUS_REPORTS_REQUEST });

  try {
    const result = await apiClient.get("/report/view", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    dispatch({
      type: FETCH_MALICIOUS_REPORTS_SUCCESS,
      payload: {
        reports: result.data.reports,
      },
    });
  } catch (error) {
    dispatch({
      type: FETCH_MALICIOUS_REPORTS_FAILURE,
      payload: {
        statuscode: error.response?.data?.code,
        message: getErrorMessage(error),
      },
    });
  }
};

/**
 * Reset malicious reports data
 * @returns {Function} Redux thunk action
 */
export const resetData = () => (dispatch) => {
  dispatch({ type: RESET_MALICIOUS_REPORTS_DATA });
};
