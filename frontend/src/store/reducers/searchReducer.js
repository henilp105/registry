import {
  SEARCH_REQUEST,
  SEARCH_SUCCESS,
  SEARCH_FAILURE,
  SET_QUERY,
  SET_ORDER_BY,
} from "../actions/searchActions";
import { asList } from "./shape";

const initialState = {
  packages: null,
  totalPages: null,
  error: null,
  currentPage: 0,
  query: "",
  orderBy: "None",
  isLoading: false,
  // The id of the newest request; older responses are dropped (defect D83).
  latestId: 0,
};

const searchReducer = (state = initialState, action) => {
  switch (action.type) {
    case SEARCH_REQUEST:
      return {
        ...state,
        isLoading: true,
        error: null,
        latestId: action.payload?.id ?? state.latestId,
      };

    case SEARCH_SUCCESS:
      if ((action.payload?.id ?? 0) < state.latestId) return state; // stale
      return {
        ...state,
        isLoading: false,
        packages: asList(action.payload.packages),
        totalPages: action.payload.totalPages,
        currentPage: action.payload.currentPage,
        error: null,
      };

    case SEARCH_FAILURE:
      if ((action.payload?.id ?? 0) < state.latestId) return state; // stale
      return {
        ...state,
        isLoading: false,
        error: action.payload.error,
      };

    case SET_QUERY:
      return {
        ...state,
        query: action.payload.query,
      };

    case SET_ORDER_BY:
      return {
        ...state,
        orderBy: action.payload.orderBy,
      };

    default:
      return state;
  }
};

export default searchReducer;
