import {
  FETCH_NAMESPACE_DATA_REQUEST,
  FETCH_NAMESPACE_DATA_SUCCESS,
  FETCH_NAMESPACE_DATA_FAILURE,
} from "../actions/namespaceActions";
import { asList } from "./shape";

const initialState = {
  dateJoined: "",
  projects: [],
  isLoading: false,
  notFound: false,
  error: null,
};

const namespaceReducer = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_NAMESPACE_DATA_REQUEST:
      return {
        ...state,
        isLoading: true,
        notFound: false,
        error: null,
      };

    case FETCH_NAMESPACE_DATA_SUCCESS:
      return {
        ...state,
        dateJoined: action.payload.dateJoined,
        // The reducer is the shape boundary: every consumer reads `projects`
        // without checking, and `namespace.js` does `projects.length` to render
        // the count. So a response whose `packages` is not an array used to throw
        // `Cannot read properties of undefined (reading 'length')` and blank the
        // page.
        //
        // That was not hypothetical. Injecting a 200 response with a non-JSON
        // body -- a proxy returning an HTML error page, a truncated response, a
        // captive portal -- reproduced it exactly, and the page rendered nothing
        // at all rather than an error.
        //
        // Normalising here rather than in the component means one place, and no
        // consumer can be surprised later.
        projects: asList(action.payload.projects),
        isLoading: false,
        notFound: false,
        error: null,
      };

    case FETCH_NAMESPACE_DATA_FAILURE:
      return {
        ...state,
        isLoading: false,
        notFound: true,
        error: action.payload?.message || "Namespace not found",
      };

    default:
      return state;
  }
};

export default namespaceReducer;
  