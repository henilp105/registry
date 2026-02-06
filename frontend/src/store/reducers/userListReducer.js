import {
  FETCH_USERS_LIST_REQUEST,
  FETCH_USERS_LIST_SUCCESS,
  FETCH_USERS_LIST_FAILURE,
} from "../actions/userListActions";

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
      return {
        ...state,
        isLoading: true,
        error: null,
        users: null,
      };

    case FETCH_USERS_LIST_SUCCESS:
      return {
        ...state,
        isLoading: false,
        users: action.payload.users,
        error: null,
      };

    case FETCH_USERS_LIST_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload?.message || "An error occurred",
        users: null,
      };

    default:
      return state;
  }
};

export default userListReducer;
