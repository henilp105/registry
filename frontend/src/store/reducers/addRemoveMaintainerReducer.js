import {
  ADD_MAINTAINER_REQUEST,
  ADD_MAINTAINER_SUCCESS,
  ADD_MAINTAINER_FAILURE,
  REMOVE_MAINTAINER_REQUEST,
  REMOVE_MAINTAINER_SUCCESS,
  REMOVE_MAINTAINER_FAILURE,
  RESET_MAINTAINER_MESSAGES,
} from "../actions/addRemoveMaintainerActions";

const initialState = {
  isLoading: false,
  successMessage: null,
  errorMessage: null,
};

const addRemoveMaintainerReducer = (state = initialState, action) => {
  switch (action.type) {
    // Add maintainer
    case ADD_MAINTAINER_REQUEST:
      return {
        ...state,
        isLoading: true,
        successMessage: null,
        errorMessage: null,
      };

    case ADD_MAINTAINER_SUCCESS:
      return {
        ...state,
        isLoading: false,
        successMessage: action.payload.message,
        errorMessage: null,
      };

    case ADD_MAINTAINER_FAILURE:
      return {
        ...state,
        isLoading: false,
        errorMessage: action.payload.message,
        successMessage: null,
      };

    // Remove maintainer
    case REMOVE_MAINTAINER_REQUEST:
      return {
        ...state,
        isLoading: true,
        successMessage: null,
        errorMessage: null,
      };

    case REMOVE_MAINTAINER_SUCCESS:
      return {
        ...state,
        isLoading: false,
        successMessage: action.payload.message,
        errorMessage: null,
      };

    case REMOVE_MAINTAINER_FAILURE:
      return {
        ...state,
        isLoading: false,
        errorMessage: action.payload.message,
        successMessage: null,
      };

    // Reset messages
    case RESET_MAINTAINER_MESSAGES:
      return {
        ...state,
        successMessage: null,
        errorMessage: null,
      };

    default:
      return state;
  }
};

export default addRemoveMaintainerReducer;
