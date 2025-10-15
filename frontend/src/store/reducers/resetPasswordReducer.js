import {
  FORGOT_PASSWORD_REQUEST,
  FORGOT_PASSWORD_SUCCESS,
  FORGOT_PASSWORD_FAILURE,
  RESET_PASSWORD_REQUEST,
  RESET_PASSWORD_SUCCESS,
  RESET_PASSWORD_FAILURE,
} from "../actions/resetPasswordActions";

const initialState = {
  statuscode: null,
  message: null,
  error: null,
  isLoading: false,
};

const resetPasswordReducer = (state = initialState, action) => {
  switch (action.type) {
    // Forgot password (request reset email)
    case FORGOT_PASSWORD_REQUEST:
      return {
        ...state,
        isLoading: true,
        message: null,
        error: null,
      };

    case FORGOT_PASSWORD_SUCCESS:
      return {
        ...state,
        statuscode: action.payload.statuscode,
        message: action.payload.message,
        isLoading: false,
        error: null,
      };

    case FORGOT_PASSWORD_FAILURE:
      return {
        ...state,
        statuscode: action.payload.statuscode,
        error: action.payload.message,
        isLoading: false,
        message: null,
      };

    // Reset password
    case RESET_PASSWORD_REQUEST:
      return {
        ...state,
        isLoading: true,
        message: null,
        error: null,
      };

    case RESET_PASSWORD_SUCCESS:
      return {
        ...state,
        statuscode: action.payload.statuscode,
        message: action.payload.message,
        isLoading: false,
        error: null,
      };

    case RESET_PASSWORD_FAILURE:
      return {
        ...state,
        statuscode: action.payload.statuscode,
        error: action.payload.message,
        isLoading: false,
        message: null,
      };

    default:
      return state;
  }
};

export default resetPasswordReducer;
