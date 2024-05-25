import {
  RATE_PACKAGE_REQUEST,
  RATE_PACKAGE_SUCCESS,
  RATE_PACKAGE_FAILURE,
  RESET_ERROR_MESSAGE,
} from "../actions/ratePackageActions";

const initialState = {
  isLoading: false,
  error: null,
  message: null,
  statuscode: 0,
};

const ratePackageReducer = (state = initialState, action) => {
  switch (action.type) {
    case RATE_PACKAGE_REQUEST:
      return {
        ...state,
        isLoading: true,
      };
    case RATE_PACKAGE_SUCCESS:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
      };
    case RATE_PACKAGE_FAILURE:
      return {
        ...state,
        isLoading: false,
        message: action.payload.message,
        statuscode: action.payload.statuscode,
      };
    case RESET_ERROR_MESSAGE:
      return {
        ...state,
        error: null,
        message: null,
        statuscode: 0,
      };
    default:
      return state;
  }
};

export default ratePackageReducer;
