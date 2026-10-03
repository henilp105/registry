import { authenticatedPost, getErrorMessage, isSuccessResponse } from "../utils";

// Action types
export const CREATE_NAMESPACE_REQUEST = "CREATE_NAMESPACE_REQUEST";
export const CREATE_NAMESPACE_SUCCESS = "CREATE_NAMESPACE_SUCCESS";
export const CREATE_NAMESPACE_FAILURE = "CREATE_NAMESPACE_FAILURE";
/** Clears the slice on unmount — defect D85. */
export const CREATE_NAMESPACE_RESET = "CREATE_NAMESPACE_RESET";

// Legacy aliases for backward compatibility
export const CREATE_NAMESPACE = CREATE_NAMESPACE_REQUEST;
export const CREATE_NAMESPACE_ERROR = CREATE_NAMESPACE_FAILURE;

/**
 * Drop a finished create so the form can be opened again.
 *
 * The success banner and `statuscode: 200` outlived the page, and the page
 * redirects whenever it sees 200 — so returning to /namespace/create in the
 * same session showed the old success and bounced straight back out.
 */
export const resetCreateNamespace = () => ({ type: CREATE_NAMESPACE_RESET });

/**
 * Create a new namespace
 * @param {Object} data - Namespace data
 * @param {string} data.namespace - Namespace name
 * @param {string} data.namespace_description - Namespace description
 * @param {string} data.accessToken - JWT access token
 */
export const createNamespace = (data) => async (dispatch) => {
  dispatch({ type: CREATE_NAMESPACE_REQUEST });

  try {
    const result = await authenticatedPost(
      "/namespaces",
      {
        namespace: data.namespace,
        namespace_description: data.namespace_description,
      },
      data.accessToken
    );

    if (isSuccessResponse(result)) {
      dispatch({
        type: CREATE_NAMESPACE_SUCCESS,
        payload: {
          message: result.data.message,
          statuscode: result.data.code,
        },
      });
    } else {
      dispatch({
        type: CREATE_NAMESPACE_FAILURE,
        payload: {
          message: result.data.message,
          statuscode: result.data.code,
        },
      });
    }
  } catch (error) {
    dispatch({
      type: CREATE_NAMESPACE_FAILURE,
      payload: {
        message: getErrorMessage(error),
        statuscode: error.response?.data?.code || 500,
      },
    });
  }
};
