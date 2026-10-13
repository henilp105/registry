import {
  REQUEST_PACKAGES,
  REQUEST_PACKAGES_SUCCESS,
  REQUEST_PACKAGES_FAILURE,
} from "../actions/dashboardActions";
import { asList } from "./shape";

const initialState = {
  packages: null,
  namespaces: null,
  isLoading: false,
  error: null,
};

const dashboardReducer = (state = initialState, action) => {
  switch (action.type) {
    case REQUEST_PACKAGES:
      return {
        ...state,
        isLoading: true,
        error: null,
      };

    case REQUEST_PACKAGES_SUCCESS:
      return {
        ...state,
        isLoading: false,
        packages: asList(action.payload.packages),
        // Same D63 hardening as `packages` above: dashboard.js guards with
        // `!namespaces || namespaces.length === 0` and then calls
        // `namespaces.map`. A truthy non-array (proxy error page, truncated
        // body) slips past the guard and throws, blanking the dashboard.
        namespaces: asList(action.payload.namespaces),
        error: null,
      };

    case REQUEST_PACKAGES_FAILURE:
      return {
        ...state,
        isLoading: false,
        error: action.payload?.message || "Failed to load packages",
      };

    default:
      return state;
  }
};

export default dashboardReducer;
