import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { login, resetErrorMessage } from "../store/actions/authActions";
import { InfoCircle, ExclamationCircleFill, Eye, EyeSlash } from "react-bootstrap-icons";
import "./auth.css";

/** Inline hint attached to a field label.
 *
 *  The visible bubble is aria-hidden and the text is exposed once via
 *  aria-describedby on the input instead. Without that, a screen reader
 *  announced the same hint twice (once from the bubble, once from the
 *  describedby) - and the bubble was hover-only, so it could not be reached
 *  by keyboard at all. The .auth-tooltip-text CSS now also opens on
 *  :focus-within, so sighted keyboard users see it too.
 */
const Tooltip = ({ text, id }) => (
  <span className="auth-tooltip" tabIndex={0}>
    <InfoCircle className="auth-tooltip-icon" aria-hidden="true" />
    <span className="auth-tooltip-text" id={id} role="tooltip">
      {text}
    </span>
  </span>
);

const Login = () => {
  const [user_identifier, setUser_identifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formValidationErrors, setFormValidationError] = useState({});
  const [touched, setTouched] = useState({ user_identifier: false, password: false });
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  const errorMessage = useSelector((state) => state.auth.error);
  const isLoading = useSelector((state) => state.auth.isLoading);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/manage/projects");
    }

    return () => {
      if (errorMessage !== null) {
        dispatch(resetErrorMessage());
      }
    };
  }, [isAuthenticated, navigate, errorMessage, dispatch]);

  const validateField = useCallback((name, value) => {
    switch (name) {
      case 'user_identifier':
        if (!value.trim()) return "Email or username is required";
        return null;
      case 'password':
        if (!value) return "Password is required";
        return null;
      default:
        return null;
    }
  }, []);

  const validateForm = useCallback(() => {
    const errors = {};
    
    const userError = validateField('user_identifier', user_identifier);
    if (userError) errors.user_identifier = userError;
    
    const passError = validateField('password', password);
    if (passError) errors.password = passError;

    setFormValidationError(errors);
    return Object.keys(errors).length === 0;
  }, [user_identifier, password, validateField]);

  const handleBlur = (field) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    const error = validateField(field, field === 'user_identifier' ? user_identifier : password);
    setFormValidationError(prev => ({
      ...prev,
      [field]: error
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ user_identifier: true, password: true });
    
    if (validateForm()) {
      dispatch(login(user_identifier, password));
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const getFieldState = (fieldName) => {
    if (!touched[fieldName]) return '';
    return formValidationErrors[fieldName] ? 'is-invalid' : '';
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img
            src={`${process.env.PUBLIC_URL}/brand/fortran-logo-256.png`}
            alt="FPM Registry"
            className="auth-logo"
          />
          <h1 className="auth-title">Welcome Back</h1>
          <p className="auth-subtitle">Sign in to your fpm Registry account</p>
        </div>
        
        {errorMessage && (
          <div className="auth-alert auth-alert-error" role="alert">
            <ExclamationCircleFill className="auth-alert-icon" />
            <span>{errorMessage}</span>
          </div>
        )}
        
        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-form-group">
            <label htmlFor="user_identifier" className="auth-label">
              Email or Username
              <Tooltip
                id="user_identifier-hint"
                text="Enter the email or username you used during registration"
              />
            </label>
            <input
              id="user_identifier"
              type="text"
              name="user_identifier"
              className={`auth-input ${getFieldState('user_identifier')}`}
              placeholder="Enter your email or username"
              value={user_identifier}
              onChange={(e) => setUser_identifier(e.target.value)}
              onBlur={() => handleBlur('user_identifier')}
              autoComplete="username"
              autoFocus
              aria-describedby="user_identifier-hint"
              aria-invalid={!!(touched.user_identifier && formValidationErrors.user_identifier)}
            />
            {touched.user_identifier && formValidationErrors.user_identifier && (
              <div className="auth-error">
                <ExclamationCircleFill className="auth-error-icon" size={14} />
                {formValidationErrors.user_identifier}
              </div>
            )}
          </div>

          <div className="auth-form-group">
            <label htmlFor="password" className="auth-label">
              Password
            </label>
            <div className="auth-password-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                className={`auth-input ${getFieldState('password')}`}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur('password')}
                autoComplete="current-password"
                aria-invalid={!!(touched.password && formValidationErrors.password)}
              />
              {/* aria-pressed, because this is a toggle: the state is which
                  mode the field is in, and it is not conveyed by the label
                  alone ("Show password" while it is already showing). */}
              <button
                type="button"
                onClick={togglePasswordVisibility}
                className="auth-password-toggle"
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {touched.password && formValidationErrors.password && (
              <div className="auth-error">
                <ExclamationCircleFill className="auth-error-icon" size={14} />
                {formValidationErrors.password}
              </div>
            )}
          </div>

          <div className="auth-forgot">
            <Link to="/account/forgot-password">Forgot password?</Link>
          </div>

          <button 
            type="submit" 
            className="auth-submit-btn"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="auth-links">
          <p>
            Don&rsquo;t have an account?{" "}
            <Link to="/account/register">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;