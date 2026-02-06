import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { forgot } from "../store/actions/resetPasswordActions";
import { Link } from "react-router-dom";
import { InfoCircle, ExclamationCircleFill, CheckCircleFill } from "react-bootstrap-icons";
import "./auth.css";

const Tooltip = ({ text }) => (
  <span className="auth-tooltip">
    <InfoCircle className="auth-tooltip-icon" />
    <span className="auth-tooltip-text">{text}</span>
  </span>
);

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [touched, setTouched] = useState(false);
  
  const dispatch = useDispatch();
  const { message, statuscode, isLoading } = useSelector(
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
    const error = validateEmail(email);
    setFormErrors(error ? { email: error } : {});
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
            src="https://fortran-lang.org/_static/fortran-logo-256x256.png" 
            alt="FPM Registry" 
            className="auth-logo"
          />
          <h1 className="auth-title">Forgot Password?</h1>
          <p className="auth-subtitle">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </div>

        {message && (
          <div className={`auth-alert ${isSuccess ? 'auth-alert-success' : 'auth-alert-error'}`}>
            {isSuccess ? (
              <CheckCircleFill className="auth-alert-icon" />
            ) : (
              <ExclamationCircleFill className="auth-alert-icon" />
            )}
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-form-group">
            <label htmlFor="email" className="auth-label">
              Email Address
              <Tooltip text="Enter the email you used to create your account" />
            </label>
            <input
              id="email"
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
