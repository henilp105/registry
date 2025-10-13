import { get, isSuccessResponse } from "../utils";

// Action types
export const REQUEST_PACKAGES = "REQUEST_PACKAGES";
export const REQUEST_PACKAGES_SUCCESS = "REQUEST_PACKAGES_SUCCESS";
export const REQUEST_PACKAGES_FAILURE = "REQUEST_PACKAGES_FAILURE";

/**
 * Fetch user's packages and namespaces for dashboard
 * @param {string} username - Username to fetch data for
 */
export const fetchPackages = (username) => async (dispatch) => {
  dispatch({ type: REQUEST_PACKAGES });

  try {
    const result = await get(`/users/${username}`);

    if (isSuccessResponse(result)) {
      dispatch({
        type: REQUEST_PACKAGES_SUCCESS,
        payload: {
          packages: result.data.packages,
          namespaces: result.data.namespaces,
        },
      });
    } else {
      dispatch({
        type: REQUEST_PACKAGES_FAILURE,
        payload: { message: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: REQUEST_PACKAGES_FAILURE,
      payload: { message: error.response?.data?.message || "Failed to fetch packages" },
    });
  }
};
