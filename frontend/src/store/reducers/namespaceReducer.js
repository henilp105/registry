import {
  FETCH_NAMESPACE_DATA_REQUEST,
  FETCH_NAMESPACE_DATA_SUCCESS,
  FETCH_NAMESPACE_DATA_FAILURE,
} from "../actions/namespaceActions";
import { asList } from "./shape";

const initialState = {
  dateJoined: "",
  // D67. Defaults to "" so the view can test it for emptiness rather than
  // guarding against undefined at three call sites.
  description: "",
  projects: [],
  isLoading: false,
  notFound: false,
  error: null,
  // Newest in-flight fetch; stale responses are ignored (defect D85).
  latestId: 0,
};

const namespaceReducer = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_NAMESPACE_DATA_REQUEST:
      return {
        ...state,
        isLoading: true,
        notFound: false,
        error: null,
        latestId: action.payload?.id ?? state.latestId,
      };

    case FETCH_NAMESPACE_DATA_SUCCESS:
      if ((action.payload?.id ?? 0) < state.latestId) return state; // stale
      return {
        ...state,
        dateJoined: action.payload.dateJoined,
        description: action.payload.description ?? "",
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
      if ((action.payload?.id ?? 0) < state.latestId) return state; // stale
      return {
        ...state,
        isLoading: false,
        // Defect D85: any failure — 500, 429, offline — used to claim the
        // namespace does not exist, and namespace.js redirects to /404 on
        // `notFound`. Not-found is a property of the *status*, not the error.
        notFound: action.payload?.httpStatus === 404,
        error: action.payload?.message || "Namespace not found",
      };

    default:
      return state;
  }
};

export default namespaceReducer;
  