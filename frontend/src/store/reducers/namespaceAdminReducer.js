import {
  ADD_NAMESPACE_ADMIN_REQUEST,
  ADD_NAMESPACE_ADMIN_SUCCESS,
  ADD_NAMESPACE_ADMIN_FAILURE,
  REMOVE_NAMESPACE_ADMIN_REQUEST,
  REMOVE_NAMESPACE_ADMIN_SUCCESS,
  REMOVE_NAMESPACE_ADMIN_FAILURE,
  RESET_ERROR_MESSAGE,
} from "../actions/namespaceAdminsActions";

const initialState = {
  successMessage: null,
  errorMessage: null,
  // Defect D101: written by no reducer and read by all four namespace-membership
  // dialogs for `disabled` and their "Adding…"/"Removing…" spinner. With no
  // REQUEST case the button was never disabled and never showed progress, so a
  // slow request could be submitted repeatedly -- each one a write against the
  // namespace. The package-level reducer (`addRemoveMaintainerReducer`) already
  // handled its REQUEST types; this is the same omission, twice, on the
  // namespace side.
  isLoading: false,
};

const addRemoveNamespaceAdminReducer = (state = initialState, action) => {
  switch (action.type) {
    case ADD_NAMESPACE_ADMIN_REQUEST:
    case REMOVE_NAMESPACE_ADMIN_REQUEST:
      // Cleared on the way in as well as tracked, for the same reason as
      // `handleRequest`: a retry that kept the previous attempt's message on
      // screen while running looked like it had already succeeded.
      return {
        ...state,
        isLoading: true,
        successMessage: null,
        errorMessage: null,
      };

    case ADD_NAMESPACE_ADMIN_SUCCESS:
    case REMOVE_NAMESPACE_ADMIN_SUCCESS:
      return {
        ...state,
        isLoading: false,
        successMessage: action.payload.message,
        errorMessage: null,
      };

    case ADD_NAMESPACE_ADMIN_FAILURE:
    case REMOVE_NAMESPACE_ADMIN_FAILURE:
      return {
        ...state,
        isLoading: false,
        errorMessage: action.payload.message,
        successMessage: null,
      };
    case RESET_ERROR_MESSAGE:
      return {
        ...state,
        successMessage: null,
        errorMessage: null,
        isLoading: false,
      };
    default:
      return state;
  }
};

export default addRemoveNamespaceAdminReducer;
