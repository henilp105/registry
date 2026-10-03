import { get, getErrorMessage } from "../utils";

// Action types
export const FETCH_USER_DATA_REQUEST = "FETCH_USER_DATA_REQUEST";
export const FETCH_USER_DATA_SUCCESS = "FETCH_USER_DATA_SUCCESS";
export const FETCH_USER_DATA_FAILURE = "FETCH_USER_DATA_FAILURE";

// Monotonic request id; older responses are dropped by the reducer (defect D85).
let nextUserId = 1;

// Legacy aliases for backward compatibility
export const FETCH_USER_DATA = FETCH_USER_DATA_REQUEST;
export const FETCH_USER_DATA_ERROR = FETCH_USER_DATA_FAILURE;

/**
 * Fetch user profile data
 * @param {string} user - Username to fetch
 */
export const fetchUserData = (user) => async (dispatch) => {
  // Defect D85: same D83 race as package/search.
  const id = nextUserId++;
  dispatch({ type: FETCH_USER_DATA_REQUEST, payload: { id } });

  try {
    const result = await get(`/users/${user}`);

    dispatch({
      type: FETCH_USER_DATA_SUCCESS,
      payload: {
        id,
        email: result.data.user.email,
        dateJoined: result.data.user.createdAt,
        projects: result.data.packages,
      },
    });
  } catch (error) {
    dispatch({
      type: FETCH_USER_DATA_FAILURE,
      payload: { id, message: getErrorMessage(error), httpStatus: error.response?.status ?? 0 },
    });
  }
};