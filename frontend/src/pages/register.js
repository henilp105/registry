import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { signup, resetErrorMessage } from "../store/actions/authActions";
import { InfoCircle, CheckCircleFill, ExclamationCircleFill, Eye, EyeSlash } from "react-bootstrap-icons";
import "./auth.css";

const Tooltip = ({ text }) => (
  <span className="auth-tooltip">
    <InfoCircle className="auth-tooltip-icon" />
    <span className="auth-tooltip-text">{text}</span>
  </span>
);

const Register = () => {
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: ""
  });
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  const isLoading = useSelector((state) => state.auth.isLoading);
  const message = useSelector((state) => state.auth.message);
  const errorMessage = useSelector((state) => state.auth.error);

  // Password strength indicator
  const getPasswordStrength = useCallback((password) => {
    if (!password) return { strength: 0, label: '', color: '' };
    
    let strength = 0;
    if (password.length >= 8) strength += 1;
    if (password.length >= 12) strength += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength += 1;
    if (/\d/.test(password)) strength += 1;
    if (/[^a-zA-Z0-9]/.test(password)) strength += 1;
    
    const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['#dc3545', '#fd7e14', '#ffc107', '#20c997', '#198754'];
    
    return { 
      strength, 
      label: labels[Math.min(strength, 4)], 
      color: colors[Math.min(strength, 4)] 
    };
  }, []);

  const passwordStrength = getPasswordStrength(formData.password);

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear specific error when user starts typing
    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  }, [formErrors]);

  const validateField = useCallback((name, value) => {
    let error = '';
    
    switch (name) {
      case 'username':
        if (!value.trim()) {
          error = 'Username is required';
        } else if (value.length < 3) {
          error = 'Username must be at least 3 characters';
        } else if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
          error = 'Username can only contain letters, numbers, underscores, and hyphens';
        }
        break;
      case 'email':
        if (!value.trim()) {
          error = 'Email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          error = 'Please enter a valid email address';
        }
        break;
      case 'password':
        if (!value) {
          error = 'Password is required';
        } else if (value.length < 8) {
          error = 'Password must be at least 8 characters';
        }
        break;
      case 'confirmPassword':
        if (!value) {
          error = 'Please confirm your password';
        } else if (value !== formData.password) {
          error = 'Passwords do not match';
        }
        break;
      default:
        break;
    }
    
    setFormErrors(prev => ({ ...prev, [name]: error }));
    return !error;
  }, [formData.password]);

  const handleBlur = useCallback((e) => {
    const { name } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    validateField(name, formData[name]);
  }, [formData, validateField]);

  const validateForm = useCallback(() => {
    const fields = ['username', 'email', 'password', 'confirmPassword'];
    let isValid = true;
    
    fields.forEach(field => {
      if (!validateField(field, formData[field])) {
        isValid = false;
      }
    });
    
    setTouched({ username: true, email: true, password: true, confirmPassword: true });
    return isValid;
  }, [formData, validateField]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validateForm()) {
      dispatch(signup(formData.username, formData.email, formData.password));
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/manage/projects");
    }

    return () => {
      if (errorMessage != null) {
        dispatch(resetErrorMessage());
      }
    };
  }, [isAuthenticated, navigate, dispatch, errorMessage]);

  // Reset error message on mount
  useEffect(() => {
    dispatch(resetErrorMessage());
  }, [dispatch]);

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword(prev => !prev);
  }, []);

  const getFieldState = useCallback((fieldName) => {
    if (!touched[fieldName]) return '';
    return formErrors[fieldName] ? 'is-invalid' : 'is-valid';
  }, [touched, formErrors]);

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img 
            src="https://fortran-lang.org/_static/fortran-logo-256x256.png" 
            alt="FPM Registry" 
            className="auth-logo"
          />
          <h1 className="auth-title">Create Account</h1>
          <p className="auth-subtitle">Join the fpm Registry community</p>
        </div>

        {errorMessage && (
          <div className="auth-alert auth-alert-error">
            <ExclamationCircleFill className="auth-alert-icon" />
            <span>{errorMessage}</span>
          </div>
        )}
        
        {message && (
          <div className="auth-alert auth-alert-success">
            <CheckCircleFill className="auth-alert-icon" />
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-form-group">
            <label htmlFor="username" className="auth-label">
              Username
              <Tooltip text="3+ characters: letters, numbers, underscores, hyphens" />
            </label>
            <input
              id="username"
              type="text"
              name="username"
              className={`auth-input ${getFieldState('username')}`}
              placeholder="Enter your username"
              value={formData.username}
              onChange={handleChange}
              onBlur={handleBlur}
              autoComplete="username"
            />
            {touched.username && formErrors.username && (
              <div className="auth-error">
                <ExclamationCircleFill className="auth-error-icon" size={14} />
                {formErrors.username}
              </div>
            )}
          </div>

          <div className="auth-form-group">
            <label htmlFor="email" className="auth-label">
              Email
              <Tooltip text="We'll send a verification email to this address" />
            </label>
            <input
              id="email"
              type="email"
              name="email"
              className={`auth-input ${getFieldState('email')}`}
              placeholder="Enter your email address"
              value={formData.email}
              onChange={handleChange}
              onBlur={handleBlur}
              autoComplete="email"
            />
            {touched.email && formErrors.email && (
              <div className="auth-error">
                <ExclamationCircleFill className="auth-error-icon" size={14} />
                {formErrors.email}
              </div>
            )}
          </div>

          <div className="auth-form-group">
            <label htmlFor="password" className="auth-label">
              Password
              <Tooltip text="Minimum 8 characters. Mix letters, numbers & symbols for strength." />
            </label>
            <div className="auth-password-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                className={`auth-input ${getFieldState('password')}`}
                placeholder="Create a strong password"
                value={formData.password}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={togglePasswordVisibility}
                className="auth-password-toggle"
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
            {formData.password && !formErrors.password && (
              <div className="password-strength">
                <div className="password-strength-bar">
                  <div 
                    className="password-strength-fill"
                    style={{ 
                      width: `${passwordStrength.strength * 20}%`,
                      backgroundColor: passwordStrength.color
                    }}
                  />
                </div>
                <span className="password-strength-label" style={{ color: passwordStrength.color }}>
                  {passwordStrength.label}
                </span>
              </div>
            )}
          </div>

          <div className="auth-form-group">
            <label htmlFor="confirmPassword" className="auth-label">
              Confirm Password
            </label>
            <div className="auth-password-wrapper">
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                name="confirmPassword"
                className={`auth-input ${getFieldState('confirmPassword')}`}
                placeholder="Re-enter your password"
                value={formData.confirmPassword}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="new-password"
              />
            </div>
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
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="auth-links">
          <p>
            Already have an account? <Link to="/account/login">Sign in</Link>
          </p>
          <p>
            <Link to="/account/forgot-password">Forgot password?</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;