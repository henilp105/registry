import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { signup, resetErrorMessage } from "../store/actions/authActions";
import Container from "react-bootstrap/Container";
import Form from "react-bootstrap/Form";

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
    if (!touched[fieldName]) return {};
    return formErrors[fieldName] ? { isInvalid: true } : { isValid: true };
  }, [touched, formErrors]);

  return (
    <Container style={{ paddingTop: 25 }}>
      <form id="login-form" onSubmit={handleSubmit} noValidate>
        <h1>Welcome to fpm Registry!</h1>
        <p className="text-muted mb-4">Create your account to get started.</p>
        
        <Form.Group className="mb-3">
          <Form.Label htmlFor="username" className="visually-hidden">Username</Form.Label>
          <Form.Control
            id="username"
            type="text"
            name="username"
            placeholder="Username"
            value={formData.username}
            onChange={handleChange}
            onBlur={handleBlur}
            autoComplete="username"
            aria-describedby={formErrors.username ? "username-error" : undefined}
            {...getFieldState('username')}
          />
          {touched.username && formErrors.username && (
            <Form.Control.Feedback type="invalid" id="username-error" className="d-block">
              {formErrors.username}
            </Form.Control.Feedback>
          )}
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label htmlFor="email" className="visually-hidden">Email</Form.Label>
          <Form.Control
            id="email"
            type="email"
            name="email"
            placeholder="Email"
            value={formData.email}
            onChange={handleChange}
            onBlur={handleBlur}
            autoComplete="email"
            aria-describedby={formErrors.email ? "email-error" : undefined}
            {...getFieldState('email')}
          />
          {touched.email && formErrors.email && (
            <Form.Control.Feedback type="invalid" id="email-error" className="d-block">
              {formErrors.email}
            </Form.Control.Feedback>
          )}
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label htmlFor="password" className="visually-hidden">Password</Form.Label>
          <div className="position-relative">
            <Form.Control
              id="password"
              type={showPassword ? "text" : "password"}
              name="password"
              placeholder="Password"
              value={formData.password}
              onChange={handleChange}
              onBlur={handleBlur}
              autoComplete="new-password"
              aria-describedby={formErrors.password ? "password-error" : "password-strength"}
              {...getFieldState('password')}
              style={{ paddingRight: '45px' }}
            />
            <button
              type="button"
              onClick={togglePasswordVisibility}
              className="btn btn-link position-absolute"
              style={{ 
                right: '5px', 
                top: '50%', 
                transform: 'translateY(-50%)',
                padding: '0.25rem',
                color: '#6c757d',
                textDecoration: 'none'
              }}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
            </button>
          </div>
          {touched.password && formErrors.password && (
            <Form.Control.Feedback type="invalid" id="password-error" className="d-block">
              {formErrors.password}
            </Form.Control.Feedback>
          )}
          {formData.password && !formErrors.password && (
            <div id="password-strength" className="mt-2">
              <div className="d-flex align-items-center gap-2">
                <div 
                  className="progress flex-grow-1" 
                  style={{ height: '6px' }}
                  role="progressbar"
                  aria-valuenow={passwordStrength.strength * 20}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-label="Password strength"
                >
                  <div 
                    className="progress-bar" 
                    style={{ 
                      width: `${passwordStrength.strength * 20}%`,
                      backgroundColor: passwordStrength.color,
                      transition: 'width 0.3s ease, background-color 0.3s ease'
                    }}
                  ></div>
                </div>
                <small style={{ color: passwordStrength.color, minWidth: '70px' }}>
                  {passwordStrength.label}
                </small>
              </div>
            </div>
          )}
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label htmlFor="confirmPassword" className="visually-hidden">Confirm Password</Form.Label>
          <Form.Control
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            name="confirmPassword"
            placeholder="Confirm Password"
            value={formData.confirmPassword}
            onChange={handleChange}
            onBlur={handleBlur}
            autoComplete="new-password"
            aria-describedby={formErrors.confirmPassword ? "confirm-password-error" : undefined}
            {...getFieldState('confirmPassword')}
          />
          {touched.confirmPassword && formErrors.confirmPassword && (
            <Form.Control.Feedback type="invalid" id="confirm-password-error" className="d-block">
              {formErrors.confirmPassword}
            </Form.Control.Feedback>
          )}
        </Form.Group>

        {errorMessage && (
          <div className="alert alert-danger py-2 d-flex align-items-center" role="alert">
            <i className="fas fa-exclamation-circle me-2" aria-hidden="true"></i>
            {errorMessage}
          </div>
        )}
        
        {message && (
          <div className="alert alert-success py-2 d-flex align-items-center" role="alert">
            <i className="fas fa-check-circle me-2" aria-hidden="true"></i>
            {message}
          </div>
        )}

        <button 
          type="submit" 
          className="btn btn-primary w-100 py-2 mb-3"
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Creating account...
            </>
          ) : (
            'Create Account'
          )}
        </button>

        <p className="text-center mb-2">
          Already have an account? <Link to="/account/login">Log in</Link>
        </p>
        <p className="text-center">
          <Link to="/account/forgot-password">Forgot password?</Link>
        </p>
      </form>
    </Container>
  );
};

export default Register;