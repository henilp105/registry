import {
  FETCH_USER_DATA_REQUEST,
  FETCH_USER_DATA_SUCCESS,
  FETCH_USER_DATA_FAILURE,
} from "../actions/userActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";
import { asList } from "./shape";

const initialState = {
  email: "",
  dateJoined: "",
  projects: [],
  error: null,
  isLoading: false,
  notFound: false,
  // Newest in-flight fetch; stale responses are ignored (defect D85).
  latestId: 0,
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
      return handleRequest(state, { notFound: false, latestId: action.payload?.id ?? state.latestId });

    case FETCH_USER_DATA_SUCCESS:
      if ((action.payload?.id ?? 0) < state.latestId) return state; // stale
      return handleSuccess(state, {
        email: action.payload.email,
        dateJoined: action.payload.dateJoined,
        projects: asList(action.payload.projects),
        notFound: false,
      });

    case FETCH_USER_DATA_FAILURE:
      if ((action.payload?.id ?? 0) < state.latestId) return state; // stale
      return handleFailure(state, action.payload?.message, {
        notFound: action.payload?.httpStatus === 404,
      });

    default:
      return state;
  }
};

export default userReducer;
