import { post, getErrorMessage, isSuccessResponse } from "../utils";
import apiClient from "../utils/apiClient";

// Action types - consistent _REQUEST/_SUCCESS/_FAILURE naming
export const LOGIN_REQUEST = "LOGIN_REQUEST";
export const LOGIN_SUCCESS = "LOGIN_SUCCESS";
export const LOGIN_FAILURE = "LOGIN_FAILURE";

export const LOGOUT_REQUEST = "LOGOUT_REQUEST";
export const LOGOUT_SUCCESS = "LOGOUT_SUCCESS";
export const LOGOUT_FAILURE = "LOGOUT_FAILURE";

export const SIGNUP_REQUEST = "SIGNUP_REQUEST";
export const SIGNUP_SUCCESS = "SIGNUP_SUCCESS";
export const SIGNUP_FAILURE = "SIGNUP_FAILURE";

export const RESET_ERROR_MESSAGE = "RESET_ERROR_MESSAGE";

/**
 * Login user with identifier (username or email) and password
 * @param {string} userIdentifier - Username or email
 * @param {string} password - User password
 */
export const login = (userIdentifier, password) => async (dispatch) => {
  dispatch({ type: LOGIN_REQUEST });

  try {
    const result = await post("/auth/login", {
      user_identifier: userIdentifier,
      password,
    });

    if (isSuccessResponse(result)) {
      dispatch({
        type: LOGIN_SUCCESS,
        payload: {
          accessToken: result.data.access_token,
          refreshToken: result.data.refresh_token,
          username: result.data.username,
        },
      });
    } else {
      dispatch({
        type: LOGIN_FAILURE,
        payload: { error: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: LOGIN_FAILURE,
      payload: { error: getErrorMessage(error) },
    });
  }
};

/**
 * Purge the persisted `auth` slice from localStorage.
 *
 * redux-persist writes `persist:root` under this key. Removing it means a
 * stale access/refresh token cannot be resurrected by a later page load even if
 * the logout round-trip itself failed.
 */
export const PURGE_PERSISTED_AUTH = "PURGE_PERSISTED_AUTH";

const persistedAuthStorageKey = "persist:root";

/**
 * Logout user
 *
 * The local session is always torn down, whether or not the server accepts the
 * call: the old code only dispatched LOGOUT_SUCCESS when the response carried
 * `code === 200`, so a network error or a non-200 body left the access and
 * refresh tokens sitting in localStorage.
 * @param {string} accessToken - JWT access token
 */
export const logout = (accessToken) => async (dispatch) => {
  dispatch({ type: LOGOUT_REQUEST });

  const tearDown = () => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem(persistedAuthStorageKey);
        if (raw) {
          const persisted = JSON.parse(raw);
          delete persisted.auth;
          window.localStorage.setItem(persistedAuthStorageKey, JSON.stringify(persisted));
        }
      }
    } catch {
      // A blocked or corrupt localStorage must not prevent signing out.
    }
    dispatch({ type: PURGE_PERSISTED_AUTH });
    dispatch({ type: LOGOUT_SUCCESS });
  };

  if (!accessToken) {
    tearDown();
    return;
  }

  try {
    await apiClient.post("/auth/logout", null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    tearDown();
  } catch (error) {
    // Still sign out locally - the token is being discarded either way.
    tearDown();
    dispatch({ type: LOGOUT_FAILURE, payload: { error: getErrorMessage(error) } });
  }
};

/**
 * Register new user
 * @param {string} username - Desired username
 * @param {string} email - User email
 * @param {string} password - User password
 */
export const signup = (username, email, password) => async (dispatch) => {
  dispatch({ type: SIGNUP_REQUEST });

  try {
    const result = await post("/auth/signup", { username, email, password });

    if (isSuccessResponse(result)) {
      dispatch({
        type: SIGNUP_SUCCESS,
        payload: { message: result.data.message },
      });
    } else {
      dispatch({
        type: SIGNUP_FAILURE,
        payload: { error: result.data.message },
      });
    }
  } catch (error) {
    dispatch({
      type: SIGNUP_FAILURE,
      payload: { error: getErrorMessage(error) },
    });
  }
};

/**
 * Reset error message in auth state
 */
export const resetErrorMessage = () => ({
  type: RESET_ERROR_MESSAGE,
});
