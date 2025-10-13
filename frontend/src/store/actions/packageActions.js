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
    dispatch({
      type: FETCH_PACKAGE_DATA_FAILURE,
      payload: {
        statuscode: error.response?.data?.code || 500,
        message: getErrorMessage(error),
      },
    });
  }
};

/**
 * Verify user role for a package
 * @param {string} namespaceName - Namespace name
 * @param {string} packageName - Package name
 * @param {string} uuid - User UUID
 */
export const verifyUserRole = (namespaceName, packageName, uuid) => async (dispatch) => {
  dispatch({ type: VERIFY_USER_ROLE_REQUEST });

  try {
    const result = await post(`/packages/${namespaceName}/${packageName}/verify`, { uuid });

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
