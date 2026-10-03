import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useLocation } from "react-router-dom";
import {
  setAccessToken,
  setUnauthorizedHandler,
} from "../store/utils/session";
import { LOGOUT_SUCCESS } from "../store/actions/authActions";

/**
 * Keeps the module-scoped session in sync with Redux and handles the global
 * "your session ended" path.
 *
 * Renders nothing. Must be mounted inside `<BrowserRouter>` because it
 * navigates. Also deliberately does *not* call `/auth/logout` when a 401 comes
 * back: the token is already dead, so another authenticated round-trip would
 * only produce a second 401.
 */
const SessionGuard = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const accessToken = useSelector((state) => state.auth.accessToken);

  // Mirror the store's token into the axios session on every change, including
  // the initial rehydration from redux-persist.
  useEffect(() => {
    setAccessToken(accessToken);
  }, [accessToken]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAccessToken(null);
      dispatch({ type: LOGOUT_SUCCESS });
      // Remember where the session died so login can return the user there
      // instead of dropping them at the default landing page.
      navigate("/account/login", {
        replace: true,
        state: { from: location.pathname + location.search },
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [dispatch, navigate, location]);

  return null;
};

export default SessionGuard;
