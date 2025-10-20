import { get, getErrorMessage } from "../utils";

// Action types with consistent naming
export const FETCH_ARCHIVES_DATA_REQUEST = "FETCH_ARCHIVES_DATA_REQUEST";
export const FETCH_ARCHIVES_DATA_SUCCESS = "FETCH_ARCHIVES_DATA_SUCCESS";
export const FETCH_ARCHIVES_DATA_FAILURE = "FETCH_ARCHIVES_DATA_FAILURE";

// Legacy aliases for backward compatibility
export const FETCH_ARCHIVES_DATA = FETCH_ARCHIVES_DATA_REQUEST;
export const FETCH_ARCHIVES_DATA_ERROR = FETCH_ARCHIVES_DATA_FAILURE;

/**
 * Fetch archive data from the registry
 * @returns {Function} Redux thunk action
 */
export const fetchArchiveData = () => async (dispatch) => {
  dispatch({ type: FETCH_ARCHIVES_DATA_REQUEST });

  try {
    const result = await get("/registry/archives");

    dispatch({
      type: FETCH_ARCHIVES_DATA_SUCCESS,
      payload: {
        archives: result.data.archives,
        message: result.data.message,
      },
    });
  } catch (error) {
    dispatch({
      type: FETCH_ARCHIVES_DATA_FAILURE,
      payload: {
        message: getErrorMessage(error),
      },
    });
  }
};