/**
 * Action type naming conventions and helper functions
 * Standardizes Redux action patterns across the application
 */

/**
 * Create action type constants for async operations
 * Uses consistent _REQUEST/_SUCCESS/_FAILURE naming convention
 * 
 * @param {string} baseName - Base name for the action (e.g., "LOGIN", "FETCH_USER")
 * @returns {Object} Object with REQUEST, SUCCESS, and FAILURE action type strings
 * 
 * @example
 * const LOGIN_TYPES = createAsyncActionTypes("LOGIN");
 * // Returns: { REQUEST: "LOGIN_REQUEST", SUCCESS: "LOGIN_SUCCESS", FAILURE: "LOGIN_FAILURE" }
 */
export const createAsyncActionTypes = (baseName) => ({
  REQUEST: `${baseName}_REQUEST`,
  SUCCESS: `${baseName}_SUCCESS`,
  FAILURE: `${baseName}_FAILURE`,
});

/**
 * Create a simple action creator
 * @param {string} type - Action type
 * @returns {Function} Action creator function
 */
export const createAction = (type) => (payload) => ({
  type,
  payload,
});

/**
 * Create request action
 * @param {string} type - Action type
 * @returns {Object} Redux action
 */
export const requestAction = (type) => ({
  type,
});

/**
 * Create success action with payload
 * @param {string} type - Action type
 * @param {*} payload - Action payload
 * @returns {Object} Redux action
 */
export const successAction = (type, payload) => ({
  type,
  payload,
});

/**
 * Create failure action with error message
 * @param {string} type - Action type
 * @param {string} message - Error message
 * @returns {Object} Redux action
 */
export const failureAction = (type, message) => ({
  type,
  payload: { message },
});

/**
 * Standard initial state for async operations
 */
export const asyncInitialState = {
  isLoading: false,
  error: null,
  message: null,
};

/**
 * Handle REQUEST action - set loading state
 * @param {Object} state - Current state
 * @returns {Object} New state with loading true
 */
export const handleRequest = (state) => ({
  ...state,
  isLoading: true,
  error: null,
});

/**
 * Handle SUCCESS action - clear loading, set message
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
export const handleSuccess = (state, action) => ({
  ...state,
  isLoading: false,
  message: action.payload?.message || null,
  error: null,
});

/**
 * Handle FAILURE action - clear loading, set error
 * @param {Object} state - Current state
 * @param {Object} action - Redux action
 * @returns {Object} New state
 */
export const handleFailure = (state, action) => ({
  ...state,
  isLoading: false,
  error: action.payload?.message || "An error occurred",
  message: null,
});

/**
 * Reset messages and errors
 * @param {Object} state - Current state
 * @returns {Object} New state with cleared messages
 */
export const handleResetMessages = (state) => ({
  ...state,
  error: null,
  message: null,
});
