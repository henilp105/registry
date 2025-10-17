import {
  FETCH_USER_DATA_REQUEST,
  FETCH_USER_DATA_SUCCESS,
  FETCH_USER_DATA_FAILURE,
} from "../actions/userActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  email: "",
  dateJoined: "",
  projects: [],
  error: null,
  isLoading: false,
  notFound: false,
};

/**
 * Reducer for user profile data
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const userReducer = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_USER_DATA_REQUEST:
      return handleRequest(state, { notFound: false });

    case FETCH_USER_DATA_SUCCESS:
      return handleSuccess(state, {
        email: action.payload.email,
        dateJoined: action.payload.dateJoined,
        projects: action.payload.projects,
        notFound: false,
      });

    case FETCH_USER_DATA_FAILURE:
      return handleFailure(state, action.payload?.message, {
        notFound: true,
      });

    default:
      return state;
  }
};

export default userReducer;
