import {
  CREATE_NAMESPACE_REQUEST,
  CREATE_NAMESPACE_SUCCESS,
  CREATE_NAMESPACE_FAILURE,
} from "../actions/createNamespaceActions";

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
      return {
        ...state,
        isLoading: true,
        error: null,
        message: "",
        statuscode: 0,
      };

    case CREATE_NAMESPACE_SUCCESS:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
        error: null,
      };

    case CREATE_NAMESPACE_FAILURE:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
        error: action.payload.message,
      };

    default:
      return state;
  }
};

export default createNamespaceReducer;
