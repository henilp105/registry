import {
  REPORT_PACKAGE_REQUEST,
  REPORT_PACKAGE_SUCCESS,
  REPORT_PACKAGE_FAILURE,
  RESET_REPORT_PACKAGE_MESSAGES,
} from "../actions/reportPackageActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  isLoading: false,
  error: null,
  message: null,
  statuscode: 0,
};

/**
 * Reducer for package reporting
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const reportPackageReducer = (state = initialState, action) => {
  switch (action.type) {
    case REPORT_PACKAGE_REQUEST:
      return handleRequest(state);

    case REPORT_PACKAGE_SUCCESS:
      return handleSuccess(state, {
        message: action.payload.message,
        statuscode: action.payload.statuscode,
      });

    case REPORT_PACKAGE_FAILURE:
      return handleFailure(state, action.payload.message, {
        statuscode: action.payload.statuscode,
      });

    case RESET_REPORT_PACKAGE_MESSAGES:
      return {
        ...state,
        error: null,
        message: null,
        statuscode: 0,
      };

    default:
      return state;
  }
};

export default reportPackageReducer;
