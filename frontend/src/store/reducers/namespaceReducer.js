import {
  FETCH_NAMESPACE_DATA_REQUEST,
  FETCH_NAMESPACE_DATA_SUCCESS,
  FETCH_NAMESPACE_DATA_FAILURE,
} from "../actions/namespaceActions";

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
        projects: action.payload.projects,
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
  