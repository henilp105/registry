import {
  CREATE_NAMESPACE_REQUEST,
  CREATE_NAMESPACE_SUCCESS,
  CREATE_NAMESPACE_FAILURE,
  CREATE_NAMESPACE_RESET,
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

    // Defect D85: returning to the form after a successful create rendered the
    // stale success banner and re-fired the redirect, because nothing ever
    // cleared the slice between visits.
    case CREATE_NAMESPACE_RESET:
      return { ...initialState };

    default:
      return state;
  }
};

export default createNamespaceReducer;
