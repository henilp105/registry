import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { login, resetErrorMessage } from "../store/actions/authActions";
import { Link } from "react-router-dom";
import Container from "react-bootstrap/Container";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import InputGroup from "react-bootstrap/InputGroup";

const Login = () => {
  const [user_identifier, setUser_identifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fromValidationErrors, setFormValidationError] = useState({});
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

  return (
    <Container className="d-flex justify-content-center" style={{ paddingTop: 50 }}>
      <div id="login-form" style={{ width: '100%', maxWidth: '400px' }}>
        <h1 className="mb-2">Welcome back!</h1>
        <p className="text-muted mb-4">Sign in to your FPM Registry account</p>
        
        {errorMessage && (
          <Alert 
            variant="danger" 
            dismissible 
            onClose={() => dispatch(resetErrorMessage())}
            className="mb-3"
          >
            <i className="fas fa-exclamation-circle me-2" />
            {errorMessage}
          </Alert>
        )}
        
        <Form onSubmit={handleSubmit} noValidate>
          <Form.Group className="mb-3" controlId="user_identifier">
            <Form.Label className="text-start w-100">Email or Username</Form.Label>
            <Form.Control
              type="text"
              name="user_identifier"
              placeholder="Enter your email or username"
              value={user_identifier}
              onChange={(e) => setUser_identifier(e.target.value)}
              onBlur={() => handleBlur('user_identifier')}
              isInvalid={touched.user_identifier && !!fromValidationErrors.user_identifier}
              autoComplete="username"
              autoFocus
            />
            <Form.Control.Feedback type="invalid">
              {fromValidationErrors.user_identifier}
            </Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="mb-3" controlId="password">
            <Form.Label className="text-start w-100">Password</Form.Label>
            <InputGroup>
              <Form.Control
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur('password')}
                isInvalid={touched.password && !!fromValidationErrors.password}
                autoComplete="current-password"
              />
              <Button 
                variant="outline-secondary"
                onClick={togglePasswordVisibility}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
              </Button>
              <Form.Control.Feedback type="invalid">
                {fromValidationErrors.password}
              </Form.Control.Feedback>
            </InputGroup>
          </Form.Group>

          <div className="d-flex justify-content-end mb-3">
            <Link to="/account/forgot-password" className="text-decoration-none">
              Forgot password?
            </Link>
          </div>

          <Button 
            variant="primary" 
            type="submit" 
            className="w-100 mb-3"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </Button>
          
          <p className="text-center text-muted">
            Don't have an account?{" "}
            <Link to="/account/register" className="text-decoration-none fw-medium">
              Create one
            </Link>
          </p>
        </Form>
      </div>
    </Container>
  );
};

export default Login;