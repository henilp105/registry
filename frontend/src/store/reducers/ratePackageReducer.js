import {
  RATE_PACKAGE_REQUEST,
  RATE_PACKAGE_SUCCESS,
  RATE_PACKAGE_FAILURE,
  RESET_RATE_PACKAGE_MESSAGES,
} from "../actions/ratePackageActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  isLoading: false,
  error: null,
  message: null,
  statuscode: 0,
};

/**
 * Reducer for package rating
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const ratePackageReducer = (state = initialState, action) => {
  switch (action.type) {
    case RATE_PACKAGE_REQUEST:
      return handleRequest(state);

    case RATE_PACKAGE_SUCCESS:
      return handleSuccess(state, {
        message: action.payload.message,
        statuscode: action.payload.statuscode,
      });

    case RATE_PACKAGE_FAILURE:
      return handleFailure(state, action.payload.message, {
        statuscode: action.payload.statuscode,
      });

    case RESET_RATE_PACKAGE_MESSAGES:
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

export default ratePackageReducer;
