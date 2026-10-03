import {
  ADD_NAMESPACE_MAINTAINER_REQUEST,
  ADD_NAMESPACE_MAINTAINER_SUCCESS,
  ADD_NAMESPACE_MAINTAINER_FAILURE,
  RESET_ERROR_MESSAGE,
  REMOVE_NAMESPACE_MAINTAINER_REQUEST,
  REMOVE_NAMESPACE_MAINTAINER_SUCCESS,
  REMOVE_NAMESPACE_MAINTAINER_FAILURE,
} from "../actions/namespaceMaintainersActions";

const initialState = {
  successMessage: null,
  errorMessage: null,
  // Defect D101: written by no reducer, read by the two namespace-maintainer
  // dialogs. See the note in namespaceAdminReducer.js -- same omission, and the
  // package-level reducer already does this correctly.
  isLoading: false,
};

const addRemoveNamespaceMaintainerReducer = (state = initialState, action) => {
  switch (action.type) {
    case ADD_NAMESPACE_MAINTAINER_REQUEST:
    case REMOVE_NAMESPACE_MAINTAINER_REQUEST:
      return {
        ...state,
        isLoading: true,
        successMessage: null,
        errorMessage: null,
      };

    case ADD_NAMESPACE_MAINTAINER_SUCCESS:
    case REMOVE_NAMESPACE_MAINTAINER_SUCCESS:
      return {
        ...state,
        isLoading: false,
        successMessage: action.payload.message,
        errorMessage: null,
      };

    case ADD_NAMESPACE_MAINTAINER_FAILURE:
    case REMOVE_NAMESPACE_MAINTAINER_FAILURE:
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

export default addRemoveNamespaceMaintainerReducer;
