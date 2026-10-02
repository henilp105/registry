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
export const handleRequest = (state, arg) => ({
  ...state,
  // Merged for the same reason as handleSuccess (D69): callers pass
  // `{ errorMessage: null }` to clear a stale error, and that was being dropped,
  // so a failed attempt left its message on screen while the retry was running.
  ...(payloadOf(arg) ?? {}),
  isLoading: true,
  error: null,
});

/**
 * Normalise what callers actually pass as the second argument.
 *
 * Two shapes reach these helpers:
 *   - a Redux **action**, whose fields live under `.payload`;
 *   - a plain **fields object**, `{ successMessage, uploadToken }`.
 *
 * Defect D69: only the first was handled, and **no caller used it** -- all nine
 * call sites across eight reducers passed a plain fields object. The second
 * argument was therefore read as an action, `action.payload` was `undefined`, and
 * every one of those handlers reduced to "clear loading, set message to null":
 * a silent no-op that looked correct.
 *
 * The visible symptom was a publish credential that the server had minted and
 * stored but never showed, with no error anywhere.
 */
const payloadOf = (arg) =>
  arg && typeof arg === "object" && "payload" in arg ? arg.payload : arg;

/**
 * Handle SUCCESS action - clear loading, set message and any caller-supplied fields
 * @param {Object} state - Current state
 * @param {Object} arg - Redux action, or a plain fields object
 * @returns {Object} New state
 */
export const handleSuccess = (state, arg) => {
  const fields = payloadOf(arg) ?? {};
  return {
    ...state,
    // Caller fields win, so a reducer can set `uploadToken`, `successMessage`,
    // data arrays, and so on, rather than only a message.
    ...fields,
    isLoading: false,
    error: null,
    // Cleared explicitly. The token dialogs and the rating/report forms read
    // `errorMessage`, so without this a previous failure stayed on screen behind
    // the success -- the stale-message problem, on the success path.
    errorMessage: fields.errorMessage ?? null,
  };
};

/**
 * Handle FAILURE action - clear loading, set error
 * @param {Object} state - Current state
 * @param {Object} arg - Redux action, a plain fields object, or `null` plus fields
 * @returns {Object} New state
 *
 * Callers write `handleFailure(state, null, { errorMessage })`, so a third
 * argument is honoured as well. Without that, the message those callers meant to
 * surface was dropped and `error` fell back to a generic string.
 */
export const handleFailure = (state, arg, maybeFields) => {
  // Defect D76: the third argument used to *replace* the second, so every
  // reducer passing both threw away the API's real error message and fell back
  // to "An error occurred". Worse, when the second argument was a bare string
  // (the common case: `handleFailure(state, action.payload?.message)`) it was
  // spread into the state as indexed characters and the message was lost just
  // the same. Normalise both forms here: a string second argument is the
  // message; an object contributes its fields.
  const fromArg =
    typeof arg === "string"
      ? { message: arg }
      : (payloadOf(arg) ?? {});
  const fields = { ...fromArg, ...(maybeFields ?? {}) };
  return {
    ...state,
    ...fields,
    isLoading: false,
    // `errorMessage` is included because that is the field the reducers that call
    // this actually set; a consumer reading `error` would otherwise be left with a
    // generic "An error occurred" while the real message sat in the state unused.
    error:
      fields.error ??
      fields.errorMessage ??
      fields.message ??
      "An error occurred",
    message: null,
  };
};

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
