import {
  FETCH_ARCHIVES_DATA_REQUEST,
  FETCH_ARCHIVES_DATA_SUCCESS,
  FETCH_ARCHIVES_DATA_FAILURE,
} from "../actions/archivesActions";
import { handleRequest, handleSuccess, handleFailure } from "../utils";

const initialState = {
  archives: [],
  message: null,
  error: null,
  isLoading: false,
};

/**
 * Reducer for archives data
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
const archivesReducer = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_ARCHIVES_DATA_REQUEST:
      return handleRequest(state);

    case FETCH_ARCHIVES_DATA_SUCCESS:
      return handleSuccess(state, {
        archives: action.payload.archives,
        message: action.payload.message,
      });

    case FETCH_ARCHIVES_DATA_FAILURE:
      return handleFailure(state, action.payload?.message);

    default:
      return state;
  }
};

export default archivesReducer;
