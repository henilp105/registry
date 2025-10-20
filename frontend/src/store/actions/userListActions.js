import { post, getErrorMessage } from "../utils";

// Action types with consistent naming
export const FETCH_USERS_LIST_REQUEST = "FETCH_USERS_LIST_REQUEST";
export const FETCH_USERS_LIST_SUCCESS = "FETCH_USERS_LIST_SUCCESS";
export const FETCH_USERS_LIST_FAILURE = "FETCH_USERS_LIST_FAILURE";

// Legacy aliases for backward compatibility
export const FETCH_USERS_LIST = FETCH_USERS_LIST_REQUEST;
export const FETCH_USERS_LIST_ERROR = FETCH_USERS_LIST_FAILURE;

/**
 * Build API URL based on list type
 * @param {Object} options - Options for URL building
 * @returns {string} API URL path
 */
const buildUrl = ({ namespaceAdmins, namespaceMaintainers, packageMaintainers, namespace, packageName }) => {
  if (namespaceAdmins) {
    return `/namespaces/${namespace}/admins`;
  }
  if (namespaceMaintainers) {
    return `/namespaces/${namespace}/maintainers`;
  }
  if (packageMaintainers) {
    return `/packages/${namespace}/${packageName}/maintainers`;
  }
  return null;
};

/**
 * Fetch user list (admins or maintainers)
 * @param {Object} options - Fetch options
 * @param {boolean} options.namespaceAdmins - Fetch namespace admins
 * @param {boolean} options.namespaceMaintainers - Fetch namespace maintainers
 * @param {boolean} options.packageMaintainers - Fetch package maintainers
 * @param {string} options.namespace - Namespace name
 * @param {string} options.packageName - Package name
 * @param {string} options.uuid - User UUID
 * @returns {Function} Redux thunk action
 */
export const fetchUserListData = ({
  namespaceAdmins = false,
  namespaceMaintainers = false,
  packageMaintainers = false,
  namespace,
  packageName,
  uuid,
}) => async (dispatch) => {
  dispatch({ type: FETCH_USERS_LIST_REQUEST });

  const url = buildUrl({ namespaceAdmins, namespaceMaintainers, packageMaintainers, namespace, packageName });

  if (!url) {
    dispatch({
      type: FETCH_USERS_LIST_FAILURE,
      payload: {
        message: "Invalid list type specified",
      },
    });
    return;
  }

  try {
    const result = await post(url, { uuid });

    dispatch({
      type: FETCH_USERS_LIST_SUCCESS,
      payload: {
        users: result.data.users,
      },
    });
  } catch (error) {
    dispatch({
      type: FETCH_USERS_LIST_FAILURE,
      payload: {
        statuscode: error.response?.data?.code,
        message: getErrorMessage(error),
      },
    });
  }
};
