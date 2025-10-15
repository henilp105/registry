import { get, getErrorMessage } from "../utils";

// Action types - using consistent _REQUEST/_SUCCESS/_FAILURE naming
export const FETCH_NAMESPACE_DATA_REQUEST = "FETCH_NAMESPACE_DATA_REQUEST";
export const FETCH_NAMESPACE_DATA_SUCCESS = "FETCH_NAMESPACE_DATA_SUCCESS";
export const FETCH_NAMESPACE_DATA_FAILURE = "FETCH_NAMESPACE_DATA_FAILURE";

// Legacy aliases for backward compatibility
export const FETCH_NAMESPACE_DATA = FETCH_NAMESPACE_DATA_REQUEST;
export const FETCH_NAMESPACE_DATA_ERROR = FETCH_NAMESPACE_DATA_FAILURE;

/**
 * Fetch namespace data by namespace name
 * @param {string} namespace - Namespace name
 */
export const fetchNamespaceData = (namespace) => async (dispatch) => {
  dispatch({ type: FETCH_NAMESPACE_DATA_REQUEST });

  try {
    const result = await get(`/namespace/${namespace}`);

    dispatch({
      type: FETCH_NAMESPACE_DATA_SUCCESS,
      payload: {
        projects: result.data.packages,
        dateJoined: result.data.createdAt,
      },
    });
  } catch (error) {
    dispatch({
      type: FETCH_NAMESPACE_DATA_FAILURE,
      payload: { message: getErrorMessage(error) },
    });
  }
};
