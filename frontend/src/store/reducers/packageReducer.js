import {
  FETCH_PACKAGE_DATA_REQUEST,
  FETCH_PACKAGE_DATA_SUCCESS,
  FETCH_PACKAGE_DATA_FAILURE,
  VERIFY_USER_ROLE_REQUEST,
  VERIFY_USER_ROLE_SUCCESS,
  VERIFY_USER_ROLE_FAILURE,
} from "../actions/packageActions";

const initialState = {
  data: null,
  statuscode: null,
  httpStatus: null,
  retryAfter: null,
  isLoading: false,
  error: null,
  isVerified: null,
  isVerifying: false,
  // Newest in-flight fetch; stale responses are ignored (defect D85).
  latestId: 0,
};

const packageReducer = (state = initialState, action) => {
  switch (action.type) {
    // Fetch package data
    case FETCH_PACKAGE_DATA_REQUEST:
      // Reset the previous outcome: a stale 404 must not redirect the next
      // successful package view to /404 (audit round 5).
      return {
        ...state,
        isLoading: true,
        error: null,
        statuscode: null,
        httpStatus: null,
        retryAfter: null,
        data: null,
        latestId: action.payload?.id ?? state.latestId,
      };

    case FETCH_PACKAGE_DATA_SUCCESS:
      if ((action.payload?.id ?? 0) < state.latestId) return state; // stale
      return {
        ...state,
        isLoading: false,
        statuscode: action.payload.statuscode,
        httpStatus: null,
        retryAfter: null,
        data: action.payload.data,
        error: null,
      };

    case FETCH_PACKAGE_DATA_FAILURE:
      if ((action.payload?.id ?? 0) < state.latestId) return state; // stale
      return {
        ...state,
        isLoading: false,
        statuscode: action.payload.statuscode,
        // The transport status, kept separately so the view can tell "gone"
        // from "slow down" from "broken" without re-parsing the message.
        httpStatus: action.payload.httpStatus ?? 0,
        retryAfter: action.payload.retryAfter ?? null,
        data: null,
        error: action.payload.message,
      };

    // Verify user role
    case VERIFY_USER_ROLE_REQUEST:
      return {
        ...state,
        isVerified: null,
        isVerifying: true,
      };

    case VERIFY_USER_ROLE_SUCCESS:
      return {
        ...state,
        isVerified: action.payload.data.isVerified,
        isVerifying: false,
      };

    case VERIFY_USER_ROLE_FAILURE:
      return {
        ...state,
        isVerified: false,
        isVerifying: false,
      };

    default:
      return state;
  }
};

export default packageReducer;
