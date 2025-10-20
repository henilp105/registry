import {
  FETCH_USERS_LIST_REQUEST,
  FETCH_USERS_LIST_SUCCESS,
  FETCH_USERS_LIST_FAILURE,
} from "../actions/userListActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  users: null,
  isLoading: false,
  error: null,
};

/**
 * Reducer for user list (admins/maintainers)
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const userListReducer = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_USERS_LIST_REQUEST:
      return handleRequest(state);

    case FETCH_USERS_LIST_SUCCESS:
      return handleSuccess(state, {
        users: action.payload.users,
      });

    case FETCH_USERS_LIST_FAILURE:
      return handleFailure(state, action.payload?.message);

    default:
      return state;
  }
};

export default userListReducer;
