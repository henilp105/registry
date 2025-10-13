import {
  FETCH_PACKAGE_DATA_REQUEST,
  FETCH_PACKAGE_DATA_SUCCESS,
  FETCH_PACKAGE_DATA_FAILURE,
  VERIFY_USER_ROLE_REQUEST,
  VERIFY_USER_ROLE_SUCCESS,
  VERIFY_USER_ROLE_FAILURE,
} from "../actions/packageActions";

const initialState = {
  data: null,
  statuscode: null,
  isLoading: false,
  error: null,
  isVerified: null,
  isVerifying: false,
};

const packageReducer = (state = initialState, action) => {
  switch (action.type) {
    // Fetch package data
    case FETCH_PACKAGE_DATA_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
      };

    case FETCH_PACKAGE_DATA_SUCCESS:
      return {
        ...state,
        isLoading: false,
        statuscode: action.payload.statuscode,
        data: action.payload.data,
        error: null,
      };

    case FETCH_PACKAGE_DATA_FAILURE:
      return {
        ...state,
        isLoading: false,
        statuscode: action.payload.statuscode,
        data: null,
        error: action.payload.message,
      };

    // Verify user role
    case VERIFY_USER_ROLE_REQUEST:
      return {
        ...state,
        isVerified: null,
        isVerifying: true,
      };

    case VERIFY_USER_ROLE_SUCCESS:
      return {
        ...state,
        isVerified: action.payload.data.isVerified,
        isVerifying: false,
      };

    case VERIFY_USER_ROLE_FAILURE:
      return {
        ...state,
        isVerified: false,
        isVerifying: false,
      };

    default:
      return state;
  }
};

export default packageReducer;
