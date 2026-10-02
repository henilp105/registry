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
  // Defect D83: without sequencing, a stale response overwrites a fresh one.
  // Search for page 3, then change the sort: if page 3's response lands
  // second, it clobbers the page-0 result with content under the wrong
  // ordering. A monotonically increasing request id lets the reducer drop any
  // response that is no longer the newest request.
  const id = nextSearchId++;
  dispatch({ type: SEARCH_REQUEST, payload: { id } });

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
        id,
        packages: result.data.packages,
        totalPages: result.data.total_pages,
        currentPage: page,
      },
    });
  } catch (error) {
    dispatch({
      type: SEARCH_FAILURE,
      payload: {
        id,
        error: getErrorMessage(error),
      },
    });
  }
};

let nextSearchId = 1;

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
