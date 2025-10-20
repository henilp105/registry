import {
  GENERATE_NAMESPACE_TOKEN_REQUEST,
  GENERATE_NAMESPACE_TOKEN_SUCCESS,
  GENERATE_NAMESPACE_TOKEN_FAILURE,
  RESET_NAMESPACE_TOKEN_MESSAGES,
} from "../actions/generateNamespaceTokenActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  successMessage: null,
  errorMessage: null,
  uploadToken: null,
  isLoading: false,
};

/**
 * Reducer for namespace token generation
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const generateNamespaceTokenReducer = (state = initialState, action) => {
  switch (action.type) {
    case GENERATE_NAMESPACE_TOKEN_REQUEST:
      return handleRequest(state, { errorMessage: null });

    case GENERATE_NAMESPACE_TOKEN_SUCCESS:
      return handleSuccess(state, {
        successMessage: action.payload.message,
        uploadToken: action.payload.uploadToken,
      });

    case GENERATE_NAMESPACE_TOKEN_FAILURE:
      return handleFailure(state, null, {
        errorMessage: action.payload.message,
      });

    case RESET_NAMESPACE_TOKEN_MESSAGES:
      return {
        ...state,
        successMessage: null,
        errorMessage: null,
      };

    default:
      return state;
  }
};

export default generateNamespaceTokenReducer;
