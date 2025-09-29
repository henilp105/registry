import { get, getErrorMessage } from "../utils";

// Action types - using consistent naming convention
export const SEARCH_REQUEST = "SEARCH_REQUEST";
export const SEARCH_SUCCESS = "SEARCH_SUCCESS";
export const SEARCH_FAILURE = "SEARCH_FAILURE";

// Legacy alias for backward compatibility
export const SEARCH_LOADING = SEARCH_REQUEST;

// Map UI sort options to API parameters
const SORT_OPTIONS = {
  "Date last updated": "updatedat",
  "None": "",
  "name": "name",
  "downloads": "downloads",
};

/**
 * Search for packages with optional sorting
 * @param {string} query - Search query
 * @param {number} page - Page number (0-indexed)
 * @param {string} sortedBy - Sort option key
 */
export const searchPackage = (query, page, sortedBy = "") => async (dispatch) => {
  dispatch({ type: SEARCH_REQUEST });

  // Map sort option to API parameter
  const sortParam = SORT_OPTIONS[sortedBy] ?? sortedBy;

  try {
    const result = await get("/packages", {
      query,
      page,
      sorted_by: sortParam,
    });

    dispatch({
      type: SEARCH_SUCCESS,
      payload: {
        packages: result.data.packages,
        totalPages: result.data.total_pages,
        currentPage: page,
      },
    });
  } catch (error) {
    dispatch({
      type: SEARCH_FAILURE,
      payload: {
        error: getErrorMessage(error),
      },
    });
  }
};

export const SET_QUERY = "SET_QUERY";
export const SET_ORDER_BY = "SET_ORDER_BY";

/**
 * Set the search query
 * @param {string} query - Search query string
 */
export const setQuery = (query) => ({
  type: SET_QUERY,
  payload: { query },
});

/**
 * Set the sort order for search results
 * @param {string} orderBy - Sort option key
 */
export const setOrderBy = (orderBy) => ({
  type: SET_ORDER_BY,
  payload: { orderBy },
});
