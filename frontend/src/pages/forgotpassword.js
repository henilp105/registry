import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { forgot } from "../store/actions/resetPasswordActions";
import { Link } from "react-router-dom";
import { InfoCircle, ExclamationCircleFill, CheckCircleFill } from "react-bootstrap-icons";
import "./auth.css";

const Tooltip = ({ text, id }) => (
  <span className="auth-tooltip" tabIndex={0}>
    <InfoCircle className="auth-tooltip-icon" aria-hidden="true" />
    <span className="auth-tooltip-text" id={id} role="tooltip">
      {text}
    </span>
  </span>
);

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [touched, setTouched] = useState(false);
  
  const dispatch = useDispatch();
  // Defect D98: this read `message` only, while every failure branch of the
  // shared slice writes the text to `error` and nulls `message`. So a rejected
  // request -- unknown address, 429, 500, or no network at all -- produced a form
  // that went from "Sending…" back to idle with no output at all, which is
  // indistinguishable from a request that was never sent.
  const { message, error, statuscode, isLoading } = useSelector(
    (state) => state.resetpassword
  );

  const validateEmail = useCallback((value) => {
    if (!value.trim()) {
      return "Email is required";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "Please enter a valid email address";
    }
    return null;
  }, []);

  const validateForm = useCallback(() => {
    const emailError = validateEmail(email);
    if (emailError) {
      setFormErrors({ email: emailError });
      return false;
    }
    setFormErrors({});
    return true;
  }, [email, validateEmail]);

  const handleBlur = useCallback(() => {
    setTouched(true);
    // Renamed: a local `error` here shadowed the `error` read from the store, so
    // the render below could not have seen the server's message even after the
    // selector was fixed.
    const fieldError = validateEmail(email);
    setFormErrors(fieldError ? { email: fieldError } : {});
  }, [email, validateEmail]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    setTouched(true);
    if (validateForm()) {
      dispatch(forgot(email));
    }
  }, [dispatch, email, validateForm]);

  const isSuccess = statuscode === 200;
  const getFieldState = () => {
    if (!touched) return '';
    return formErrors.email ? 'is-invalid' : '';
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img
            src={`${process.env.PUBLIC_URL}/brand/fortran-logo-256.png`}
            alt="FPM Registry"
            className="auth-logo"
            width={64}
            height={64}
          />
          <h1 className="auth-title">Forgot Password?</h1>
          <p className="auth-subtitle">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </div>

        {(message || error) && (
          <div className={`auth-alert ${isSuccess ? 'auth-alert-success' : 'auth-alert-error'}`} role={isSuccess ? "status" : "alert"}>
            {isSuccess ? (
              <CheckCircleFill className="auth-alert-icon" />
            ) : (
              <ExclamationCircleFill className="auth-alert-icon" />
            )}
            {/* `message` on success, `error` on failure -- the two are mutually
                exclusive by construction, so this can never show a success
                banner with a failure message in it. */}
            <span>{isSuccess ? message : error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-form-group">
            <label htmlFor="email" className="auth-label">
              Email Address
            </label>
            <Tooltip id="email-hint" text="Enter the email you used to create your account" />
            <input
              id="email"
              aria-describedby="email-hint"
              type="email"
              name="email"
              className={`auth-input ${getFieldState()}`}
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={handleBlur}
              disabled={isLoading}
            />
            {touched && formErrors.email && (
              <div className="auth-error">
                <ExclamationCircleFill className="auth-error-icon" size={14} />
                {formErrors.email}
              </div>
            )}
          </div>

          <button 
            type="submit" 
            className="auth-submit-btn"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Sending...
              </>
            ) : (
              'Send Reset Link'
            )}
          </button>
        </form>

        <div className="auth-links">
          <p>
            Remember your password? <Link to="/account/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
