import React, { useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { verify } from "../store/actions/verifyEmailActions";
import { CheckCircleFill, ExclamationCircleFill, EnvelopeCheckFill, ArrowRight } from "react-bootstrap-icons";
import "./auth.css";

const VerifyEmail = () => {
  const { uuid } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const { message, statuscode, isLoading, error } = useSelector(
    (state) => state.verifyEmail
  );

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    dispatch(verify(uuid));
  }, [dispatch, uuid]);

  const isSuccess = statuscode === 200;
  const hasError = statuscode && statuscode !== 200;
  const displayMessage = message || error;

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img 
            src="https://fortran-lang.org/_static/fortran-logo-256x256.png" 
            alt="FPM Registry" 
            className="auth-logo"
          />
          <h1 className="auth-title">
            {isSuccess ? "Email Verified!" : "Verify Your Email"}
          </h1>
          <p className="auth-subtitle">
            {isSuccess 
              ? "Your email has been successfully verified" 
              : "Click the button below to verify your email address"}
          </p>
        </div>

        {/* Success State */}
        {isSuccess && (
          <div className="verify-success-container">
            <div className="verify-success-icon">
              <CheckCircleFill />
            </div>
            <div className="auth-alert auth-alert-success">
              <CheckCircleFill className="auth-alert-icon" />
              <span>{displayMessage || "Your email has been verified successfully!"}</span>
            </div>
            <button
              type="button"
              className="auth-submit-btn"
              onClick={() => navigate("/account/login")}
            >
              <span>Continue to Login</span>
              <ArrowRight />
            </button>
          </div>
        )}

        {/* Error State */}
        {hasError && !isSuccess && (
          <div className="verify-error-container">
            <div className="verify-error-icon">
              <ExclamationCircleFill />
            </div>
            <div className="auth-alert auth-alert-error">
              <ExclamationCircleFill className="auth-alert-icon" />
              <span>{displayMessage || "Verification failed. Please try again."}</span>
            </div>
            <form onSubmit={handleSubmit}>
              <button
                type="submit"
                className="auth-submit-btn verify-retry-btn"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <span className="verify-spinner"></span>
                    <span>Retrying...</span>
                  </>
                ) : (
                  <span>Try Again</span>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Initial State - Not yet clicked */}
        {!isSuccess && !hasError && (
          <form onSubmit={handleSubmit}>
            <div className="verify-initial-container">
              <div className="verify-email-icon">
                <EnvelopeCheckFill />
              </div>
              <p className="verify-instruction">
                We need to confirm your email address. Click the button below to complete your registration.
              </p>
              <button
                type="submit"
                className="auth-submit-btn"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <span className="verify-spinner"></span>
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <EnvelopeCheckFill />
                    <span>Verify Email</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        <div className="auth-links">
          <p>
            Already verified? <Link to="/account/login">Login</Link>
          </p>
          <p>
            Need help? <Link to="/help">Contact Support</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
