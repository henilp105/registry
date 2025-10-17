import { get, getErrorMessage } from "../utils";

// Action types
export const FETCH_USER_DATA_REQUEST = "FETCH_USER_DATA_REQUEST";
export const FETCH_USER_DATA_SUCCESS = "FETCH_USER_DATA_SUCCESS";
export const FETCH_USER_DATA_FAILURE = "FETCH_USER_DATA_FAILURE";

// Legacy aliases for backward compatibility
export const FETCH_USER_DATA = FETCH_USER_DATA_REQUEST;
export const FETCH_USER_DATA_ERROR = FETCH_USER_DATA_FAILURE;

/**
 * Fetch user profile data
 * @param {string} user - Username to fetch
 */
export const fetchUserData = (user) => async (dispatch) => {
  dispatch({ type: FETCH_USER_DATA_REQUEST });

  try {
    const result = await get(`/users/${user}`);

    dispatch({
      type: FETCH_USER_DATA_SUCCESS,
      payload: {
        email: result.data.user.email,
        dateJoined: result.data.user.createdAt,
        projects: result.data.packages,
      },
    });
  } catch (error) {
    dispatch({
      type: FETCH_USER_DATA_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};