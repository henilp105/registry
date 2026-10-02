import { get, post, getErrorMessage, isSuccessResponse } from "../utils";

// Action types - using consistent _REQUEST/_SUCCESS/_FAILURE naming
export const FETCH_PACKAGE_DATA_REQUEST = "FETCH_PACKAGE_DATA_REQUEST";
export const FETCH_PACKAGE_DATA_SUCCESS = "FETCH_PACKAGE_DATA_SUCCESS";
export const FETCH_PACKAGE_DATA_FAILURE = "FETCH_PACKAGE_DATA_FAILURE";

export const VERIFY_USER_ROLE_REQUEST = "VERIFY_USER_ROLE_REQUEST";
export const VERIFY_USER_ROLE_SUCCESS = "VERIFY_USER_ROLE_SUCCESS";
export const VERIFY_USER_ROLE_FAILURE = "VERIFY_USER_ROLE_FAILURE";

// Legacy aliases for backward compatibility
export const FETCH_PACKAGE_DATA = FETCH_PACKAGE_DATA_REQUEST;
export const FETCH_PACKAGE_DATA_ERROR = FETCH_PACKAGE_DATA_FAILURE;
export const VERIFY_USER_ROLE = VERIFY_USER_ROLE_REQUEST;
export const VERIFY_USER_ROLE_ERROR = VERIFY_USER_ROLE_FAILURE;

/**
 * Fetch package data by namespace and package name
 * @param {string} namespaceName - Namespace name
 * @param {string} packageName - Package name
 */
export const fetchPackageData = (namespaceName, packageName) => async (dispatch) => {
  dispatch({ type: FETCH_PACKAGE_DATA_REQUEST });

  try {
    const result = await get(`/packages/${namespaceName}/${packageName}`);

    if (isSuccessResponse(result)) {
      dispatch({
        type: FETCH_PACKAGE_DATA_SUCCESS,
        payload: {
          statuscode: result.data.code,
          data: result.data.data,
        },
      });
    } else {
      dispatch({
        type: FETCH_PACKAGE_DATA_FAILURE,
        payload: {
          statuscode: result.data.code,
          message: result.data.message,
        },
      });
    }
  } catch (error) {
    // The HTTP status, not the body's `code` field.
    //
    // `error.response?.data?.code` reads the body, which for a rate-limited or
    // proxied response may be absent, malformed, or simply not carry a `code`. It
    // then falls back to 500, and a 429 becomes indistinguishable from a genuine
    // server fault. `error.response.status` is the transport's own verdict and is
    // always present when a response arrived at all; there is no response for a
    // network failure, which is exactly the case that should read as "offline".
    const httpStatus = error.response?.status ?? 0;

    dispatch({
      type: FETCH_PACKAGE_DATA_FAILURE,
      payload: {
        statuscode: error.response?.data?.code || httpStatus || 500,
        httpStatus,
        // Seconds to wait, from the limiter. Absent on every other failure.
        retryAfter: error.response?.headers?.["retry-after"],
        message: getErrorMessage(error),
      },
    });
  }
};

/**
 * Verify user role for a package
 * @param {string} namespaceName - Namespace name
 * @param {string} packageName - Package name
 */
export const verifyUserRole = (namespaceName, packageName) => async (dispatch) => {
  dispatch({ type: VERIFY_USER_ROLE_REQUEST });

  try {
    const result = await post(`/packages/${namespaceName}/${packageName}/verify`);

    dispatch({
      type: VERIFY_USER_ROLE_SUCCESS,
      payload: { data: result.data },
    });
  } catch (error) {
    dispatch({
      type: VERIFY_USER_ROLE_FAILURE,
      payload: {
        message: getErrorMessage(error),
      },
    });
  }
};
