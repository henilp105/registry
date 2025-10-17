import {
  CREATE_NAMESPACE_REQUEST,
  CREATE_NAMESPACE_SUCCESS,
  CREATE_NAMESPACE_FAILURE,
} from "../actions/createNamespaceActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  statuscode: 0,
  message: "",
  error: null,
  isLoading: false,
};

/**
 * Reducer for namespace creation state
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const createNamespaceReducer = (state = initialState, action) => {
  switch (action.type) {
    case CREATE_NAMESPACE_REQUEST:
      return handleRequest(state, { statuscode: 0, message: "" });

    case CREATE_NAMESPACE_SUCCESS:
      return handleSuccess(state, {
        message: action.payload.message,
        statuscode: action.payload.statuscode,
      });

    case CREATE_NAMESPACE_FAILURE:
      return handleFailure(state, action.payload.message, {
        statuscode: action.payload.statuscode,
      });

    default:
      return state;
  }
};

export default createNamespaceReducer;
