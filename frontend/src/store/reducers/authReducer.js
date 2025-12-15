import {
  LOGIN_REQUEST,
  LOGIN_SUCCESS,
  LOGIN_FAILURE,
  LOGOUT_REQUEST,
  LOGOUT_SUCCESS,
  LOGOUT_FAILURE,
  SIGNUP_REQUEST,
  SIGNUP_SUCCESS,
  SIGNUP_FAILURE,
  RESET_ERROR_MESSAGE,
} from "../actions/authActions";

const initialState = {
  isAuthenticated: false,
  accessToken: null,
  refreshToken: null,
  username: null,
  isLoading: false,
  error: null,
  message: null,
};

const authReducer = (state = initialState, action) => {
  switch (action.type) {
    // Login
    case LOGIN_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
      };

    case LOGIN_SUCCESS:
      return {
        ...state,
        isAuthenticated: true,
        accessToken: action.payload.accessToken,
        refreshToken: action.payload.refreshToken,
        username: action.payload.username,
        isLoading: false,
        error: null,
      };

    case LOGIN_FAILURE:
      return {
        ...state,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload.error,
      };

    // Logout
    case LOGOUT_REQUEST:
      return {
        ...state,
        isLoading: true,
      };

    case LOGOUT_SUCCESS:
      return {
        ...initialState,
      };

    case LOGOUT_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload.error,
      };

    // Signup
    case SIGNUP_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
        message: null,
      };

    case SIGNUP_SUCCESS:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        error: null,
      };

    case SIGNUP_FAILURE:
      return {
        ...state,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload.error,
        message: null,
      };

    // Reset error
    case RESET_ERROR_MESSAGE:
      return {
        ...state,
        error: null,
        message: null,
      };

    default:
      return state;
  }
};

export default authReducer;
