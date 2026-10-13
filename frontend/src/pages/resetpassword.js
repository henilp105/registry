import React, { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { reset } from "../store/actions/resetPasswordActions";
import {
  CheckCircleFill,
  CheckLg,
  ExclamationCircleFill,
  Eye,
  EyeSlash,
} from "react-bootstrap-icons";
import "./auth.css";

const ResetPassword = () => {
  const { uuid } = useParams();
  const dispatch = useDispatch();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [touched, setTouched] = useState({});

  // Defect D98: read `error` as well as `message`. The failure branches of this
  // shared slice null `message` and write to `error`, so an expired or unknown
  // reset token -- or any server error -- showed a form that simply stopped
  // spinning, with the failure invisible and the button quietly re-enabled.
  const { message, error, statuscode, isLoading } = useSelector(
    (state) => state.resetpassword
  );

  const validateField = useCallback((name, value) => {
    switch (name) {
      case "password":
        if (!value) return "Password is required";
        if (value.length < 8) return "Password must be at least 8 characters";
        return null;
      case "confirmPassword":
        if (!value) return "Please confirm your password";
        if (value !== password) return "Passwords do not match";
        return null;
      default:
        return null;
    }
  }, [password]);

  const validateForm = useCallback(() => {
    const errors = {};

    const passwordError = validateField("password", password);
    if (passwordError) errors.password = passwordError;

    const confirmError = validateField("confirmPassword", confirmPassword);
    if (confirmError) errors.confirmPassword = confirmError;

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [password, confirmPassword, validateField]);

  const handleBlur = useCallback((field) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const value = field === "password" ? password : confirmPassword;
    const error = validateField(field, value);
    setFormErrors((prev) => ({ ...prev, [field]: error }));
  }, [password, confirmPassword, validateField]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    setTouched({ password: true, confirmPassword: true });
    if (validateForm()) {
      dispatch(reset(password, uuid));
    }
  }, [dispatch, password, uuid, validateForm]);

  const isSuccess = statuscode === 200;

  // Each field is a plain <label htmlFor> paired with a matching input id, so
  // the control is announced by name (the previous react-bootstrap version had
  // no `for` until `controlId` was added). The reveal toggle is a focusable,
  // labelled button that exposes its pressed state, rather than an icon-only
  // control with tabIndex={-1} that a keyboard user could never reach.
  const fieldClass = (field) =>
    `auth-input${touched[field] && formErrors[field] ? " is-invalid" : ""}`;

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
          <h1 className="auth-title">
            {isSuccess ? "Password Reset" : "Reset Password"}
          </h1>
          <p className="auth-subtitle">
            {isSuccess
              ? "You can now sign in with your new password."
              : "Enter your new password below."}
          </p>
        </div>

        {(message || error) && (
          <div
            className={`auth-alert ${isSuccess ? "auth-alert-success" : "auth-alert-error"}`}
            role={isSuccess ? "status" : "alert"}
          >
            {isSuccess ? (
              <CheckCircleFill className="auth-alert-icon" />
            ) : (
              <ExclamationCircleFill className="auth-alert-icon" />
            )}
            <span>{isSuccess ? message : error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-form-group">
            <label htmlFor="reset-password" className="auth-label">
              New Password
            </label>
            <div className="auth-password-wrapper">
              <input
                id="reset-password"
                type={showPassword ? "text" : "password"}
                name="password"
                className={fieldClass("password")}
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur("password")}
                autoComplete="new-password"
                disabled={isLoading || isSuccess}
                aria-invalid={!!(touched.password && formErrors.password)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                className="auth-password-toggle"
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {touched.password && formErrors.password && (
              <div className="auth-error">
                <ExclamationCircleFill className="auth-error-icon" size={14} />
                {formErrors.password}
              </div>
            )}
          </div>

          <div className="auth-form-group">
            <label htmlFor="reset-password-confirm" className="auth-label">
              Confirm Password
            </label>
            <input
              id="reset-password-confirm"
              type={showPassword ? "text" : "password"}
              name="confirmPassword"
              className={fieldClass("confirmPassword")}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => handleBlur("confirmPassword")}
              autoComplete="new-password"
              disabled={isLoading || isSuccess}
              aria-invalid={!!(touched.confirmPassword && formErrors.confirmPassword)}
            />
            {touched.confirmPassword && formErrors.confirmPassword && (
              <div className="auth-error">
                <ExclamationCircleFill className="auth-error-icon" size={14} />
                {formErrors.confirmPassword}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={isLoading || isSuccess}
          >
            {isLoading ? (
              <>
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                  aria-hidden="true"
                />
                Resetting...
              </>
            ) : isSuccess ? (
              <>
                <CheckLg size={18} />
                Password Reset
              </>
            ) : (
              "Reset Password"
            )}
          </button>
        </form>

        <div className="auth-links">
          <p>
            Remember your password? <Link to="/account/login">Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
