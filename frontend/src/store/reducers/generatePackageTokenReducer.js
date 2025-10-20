import {
  GENERATE_PACKAGE_TOKEN_REQUEST,
  GENERATE_PACKAGE_TOKEN_SUCCESS,
  GENERATE_PACKAGE_TOKEN_FAILURE,
  RESET_PACKAGE_TOKEN_MESSAGES,
} from "../actions/generatePackageTokenActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  successMessage: null,
  errorMessage: null,
  uploadToken: null,
  isLoading: false,
};

/**
 * Reducer for package token generation
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const generatePackageTokenReducer = (state = initialState, action) => {
  switch (action.type) {
    case GENERATE_PACKAGE_TOKEN_REQUEST:
      return handleRequest(state, { errorMessage: null });

    case GENERATE_PACKAGE_TOKEN_SUCCESS:
      return handleSuccess(state, {
        successMessage: action.payload.message,
        uploadToken: action.payload.uploadToken,
      });

    case GENERATE_PACKAGE_TOKEN_FAILURE:
      return handleFailure(state, null, {
        errorMessage: action.payload.message,
      });

    case RESET_PACKAGE_TOKEN_MESSAGES:
      return {
        ...state,
        successMessage: null,
        errorMessage: null,
      };

    default:
      return state;
  }
};

export default generatePackageTokenReducer;
