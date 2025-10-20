import {
  FETCH_MALICIOUS_REPORTS_REQUEST,
  FETCH_MALICIOUS_REPORTS_SUCCESS,
  FETCH_MALICIOUS_REPORTS_FAILURE,
  RESET_MALICIOUS_REPORTS_DATA,
} from "../actions/viewMalicousReportActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  reports: [],
  isLoading: false,
  error: null,
};

/**
 * Reducer for malicious package reports
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const viewMalicousReportsReducer = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_MALICIOUS_REPORTS_REQUEST:
      return handleRequest(state);

    case FETCH_MALICIOUS_REPORTS_SUCCESS:
      return handleSuccess(state, {
        reports: action.payload.reports,
      });

    case FETCH_MALICIOUS_REPORTS_FAILURE:
      return handleFailure(state, action.payload?.message);

    case RESET_MALICIOUS_REPORTS_DATA:
      return {
        ...initialState,
      };

    default:
      return state;
  }
};

export default viewMalicousReportsReducer;
