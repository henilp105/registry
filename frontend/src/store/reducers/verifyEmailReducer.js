import {
  VERIFY_EMAIL_REQUEST,
  VERIFY_EMAIL_SUCCESS,
  VERIFY_EMAIL_FAILURE,
} from "../actions/verifyEmailActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  statuscode: 0,
  message: "",
  error: null,
  isLoading: false,
};

/**
 * Reducer for email verification
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const verifyEmailReducer = (state = initialState, action) => {
  switch (action.type) {
    case VERIFY_EMAIL_REQUEST:
      return handleRequest(state);

    case VERIFY_EMAIL_SUCCESS:
      return handleSuccess(state, {
        statuscode: action.payload.statuscode,
        message: action.payload.message,
      });

    case VERIFY_EMAIL_FAILURE:
      return handleFailure(state, action.payload?.message, {
        statuscode: action.payload?.statuscode,
      });

    default:
      return state;
  }
};

export default verifyEmailReducer;
