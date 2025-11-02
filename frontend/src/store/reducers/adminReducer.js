import {
  ADMIN_AUTH_REQUEST,
  ADMIN_AUTH_SUCCESS,
  ADMIN_AUTH_FAILURE,
  DELETE_USER_REQUEST,
  DELETE_USER_SUCCESS,
  DELETE_USER_FAILURE,
  DELETE_NAMESPACE_REQUEST,
  DELETE_NAMESPACE_SUCCESS,
  DELETE_NAMESPACE_FAILURE,
  DELETE_PACKAGE_REQUEST,
  DELETE_PACKAGE_SUCCESS,
  DELETE_PACKAGE_FAILURE,
  DELETE_RELEASE_REQUEST,
  DELETE_RELEASE_SUCCESS,
  DELETE_RELEASE_FAILURE,
  DEPRECATE_PACKAGE_REQUEST,
  DEPRECATE_PACKAGE_SUCCESS,
  DEPRECATE_PACKAGE_FAILURE,
  RESET_ADMIN_MESSAGES,
} from "../actions/adminActions";

const initialState = {
  isAdmin: false,
  isLoading: false,
  error: null,
  message: null,
  statuscode: null,
};

const adminReducer = (state = initialState, action) => {
  switch (action.type) {
    // Admin authentication
    case ADMIN_AUTH_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
      };

    case ADMIN_AUTH_SUCCESS:
      return {
        ...state,
        isAdmin: true,
        isLoading: false,
        error: null,
      };

    case ADMIN_AUTH_FAILURE:
      return {
        ...state,
        isAdmin: false,
        isLoading: false,
        error: action.payload.message,
      };

    // Delete user
    case DELETE_USER_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
        message: null,
      };

    case DELETE_USER_SUCCESS:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
        error: null,
      };

    case DELETE_USER_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload.message,
        statuscode: action.payload.statuscode,
        message: null,
      };

    // Delete namespace
    case DELETE_NAMESPACE_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
        message: null,
      };

    case DELETE_NAMESPACE_SUCCESS:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
        error: null,
      };

    case DELETE_NAMESPACE_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload.message,
        statuscode: action.payload.statuscode,
        message: null,
      };

    // Delete package
    case DELETE_PACKAGE_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
        message: null,
      };

    case DELETE_PACKAGE_SUCCESS:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
        error: null,
      };

    case DELETE_PACKAGE_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload.message,
        statuscode: action.payload.statuscode,
        message: null,
      };

    // Delete release
    case DELETE_RELEASE_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
        message: null,
      };

    case DELETE_RELEASE_SUCCESS:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
        error: null,
      };

    case DELETE_RELEASE_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload.message,
        statuscode: action.payload.statuscode,
        message: null,
      };

    // Deprecate package
    case DEPRECATE_PACKAGE_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
        message: null,
      };

    case DEPRECATE_PACKAGE_SUCCESS:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
        error: null,
      };

    case DEPRECATE_PACKAGE_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload.message,
        statuscode: action.payload.statuscode,
        message: null,
      };

    case RESET_ADMIN_MESSAGES:
      return {
        ...state,
        message: null,
        error: null,
        statuscode: null,
      };

    default:
      return state;
  }
};

export default adminReducer;
