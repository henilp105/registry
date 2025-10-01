import {
  GET_USER_ACCOUNT_REQUEST,
  GET_USER_ACCOUNT_SUCCESS,
  GET_USER_ACCOUNT_FAILURE,
  RESET_PASSWORD_REQUEST,
  RESET_PASSWORD_SUCCESS,
  RESET_PASSWORD_FAILURE,
  CHANGE_EMAIL_REQUEST,
  CHANGE_EMAIL_SUCCESS,
  CHANGE_EMAIL_FAILURE,
  RESET_MESSAGES,
} from "../actions/accountActions";

const initialState = {
  email: "",
  dateJoined: "",
  isLoading: false,
  isLoadingEmail: false,
  isLoadingPassword: false,
  error: null,
  message: null,
};

const accountReducer = (state = initialState, action) => {
  switch (action.type) {
    // Get user account
    case GET_USER_ACCOUNT_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
      };

    case GET_USER_ACCOUNT_SUCCESS:
      return {
        ...state,
        email: action.payload.email,
        dateJoined: action.payload.dateJoined,
        isLoading: false,
        error: null,
      };

    case GET_USER_ACCOUNT_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload.message,
      };

    // Reset password
    case RESET_PASSWORD_REQUEST:
      return {
        ...state,
        isLoadingPassword: true,
        error: null,
        message: null,
      };

    case RESET_PASSWORD_SUCCESS:
      return {
        ...state,
        isLoadingPassword: false,
        message: action.payload.message,
        error: null,
      };

    case RESET_PASSWORD_FAILURE:
      return {
        ...state,
        isLoadingPassword: false,
        error: action.payload.message,
        message: null,
      };

    // Change email
    case CHANGE_EMAIL_REQUEST:
      return {
        ...state,
        isLoadingEmail: true,
        error: null,
        message: null,
      };

    case CHANGE_EMAIL_SUCCESS:
      return {
        ...state,
        isLoadingEmail: false,
        message: action.payload.message,
        error: null,
      };

    case CHANGE_EMAIL_FAILURE:
      return {
        ...state,
        isLoadingEmail: false,
        error: action.payload.message,
        message: null,
      };

    // Reset messages
    case RESET_MESSAGES:
      return {
        ...state,
        error: null,
        message: null,
      };

    default:
      return state;
  }
};

export default accountReducer;
