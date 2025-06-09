import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { 
  login, 
  signup, 
  resetErrorMessage 
} from "../store/actions/authActions";
import { 
  Container, 
  Form, 
  Button, 
  Card, 
  Alert,
  Spinner,
  InputGroup
} from "react-bootstrap";
import { Eye, EyeSlash } from "react-bootstrap-icons";

const AuthForm = ({ isLogin }) => {
  const [formData, setFormData] = useState({
    user_identifier: "",
    username: "",
    email: "",
    password: ""
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const authState = useSelector(state => state.auth);
  const { isAuthenticated, isLoading, message, error } = authState;

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/manage/projects");
      window.location.reload();
    }
    
    return () => {
      if (error) dispatch(resetErrorMessage());
    };
  }, [isAuthenticated, navigate, error, dispatch]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const getPasswordStrength = (password) => {
    if (password.length === 0) return { strength: 0, label: "" };
    if (password.length < 6) return { strength: 1, label: "Weak" };
    if (password.length < 10) return { strength: 2, label: "Medium" };
    return { strength: 3, label: "Strong" };
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (isLogin) {
      if (!formData.user_identifier.trim()) {
        newErrors.user_identifier = "Email or username is required";
      }
    } else {
      if (!formData.username.trim()) {
        newErrors.username = "Username is required";
      } else if (formData.username.length < 3) {
        newErrors.username = "Username must be at least 3 characters";
      }
      
      if (!formData.email.trim()) {
        newErrors.email = "Email is required";
      } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
        newErrors.email = "Email address is invalid";
      }
    }
    
    if (!formData.password) {
      newErrors.password = "Password is required";
    } else if (formData.password.length < 6) {
      newErrors.password = "Password needs at least 6 characters";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (isLogin) {
      dispatch(login(formData.user_identifier, formData.password));
    } else {
      dispatch(signup(formData.username, formData.email, formData.password));
    }
  };

  const passwordStrength = getPasswordStrength(formData.password);

  return (
    <Container 
      className="min-vh-10 d-flex align-items-center justify-content-center p-4"
      style={{
        // background: "linear-gradient(to bottom right, #dbeafe, white, #f5f3ff)"
      }}
    >
      <div className="w-100" style={{ maxWidth: "450px" }}>
        {/* Logo and Header */}
        <div className="text-center mb-4">
          <h1 
            className="fw-bold mb-2"
            style={{
              background: "linear-gradient(to right, #3b82f6, #8b5cf6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}
          >
            fpm registry
          </h1>
          <p className="text-muted">
            {isLogin 
              ? "Welcome back! Sign in to your account" 
              : "Create your account to get started"}
          </p>
        </div>

        <Card 
          className="shadow-lg border-0 overflow-hidden"
          style={{
            background: "rgba(255, 255, 255, 0.8)",
            backdropFilter: "blur(4px)"
          }}
        >
          <Card.Header className="bg-white border-0 pb-0">
            <Card.Title className="text-center fs-3 fw-semibold">
              {isLogin ? "Sign In" : "Create Account"}
            </Card.Title>
            <Card.Text className="text-center text-muted">
              {isLogin
                ? "Enter your credentials to access your account"
                : "Fill in your information to create a new account"}
            </Card.Text>
          </Card.Header>

          <Card.Body className="p-4 p-md-5">
            {/* Alert Messages */}
            {error && (
              <Alert variant="danger" className="d-flex align-items-center py-2">
                <i className="bi bi-exclamation-circle me-2"></i>
                <span>{error}</span>
              </Alert>
            )}

            {message && (
              <Alert variant="success" className="d-flex align-items-center py-2">
                <i className="bi bi-check-circle me-2"></i>
                <span>{message}</span>
              </Alert>
            )}

            <Form onSubmit={handleSubmit} className="mt-3">
              {/* Username field for signup */}
              {!isLogin && (
                <Form.Group className="mb-3">
                  <Form.Label className="fw-medium">Username</Form.Label>
                  <Form.Control
                    name="username"
                    type="text"
                    placeholder="Choose a username"
                    value={formData.username}
                    onChange={handleChange}
                    isInvalid={!!errors.username}
                    className={`${errors.username ? "border-danger" : "border-primary"} w-100 fw-medium py-2`}
                  />
                  <Form.Control.Feedback type="invalid" className="d-flex align-items-center">
                    <i className="bi bi-exclamation-circle me-1"></i>
                    {errors.username}
                  </Form.Control.Feedback>
                </Form.Group>
              )}

              {/* Email or Username field for login */}
              {isLogin ? (
                <Form.Group className="mb-3">
                  <Form.Label className="fw-medium">Email or Username</Form.Label>
                  <Form.Control
                    name="user_identifier"
                    type="text"
                    placeholder="Enter your email or username"
                    value={formData.user_identifier}
                    onChange={handleChange}
                    isInvalid={!!errors.user_identifier}
                    className={`${errors.user_identifier ? "border-danger" : "border-primary"} w-100 fw-medium py-2`}
                  />
                  <Form.Control.Feedback type="invalid" className="d-flex align-items-center">
                    <i className="bi bi-exclamation-circle me-1"></i>
                    {errors.user_identifier}
                  </Form.Control.Feedback>
                </Form.Group>
              ) : (
                <Form.Group className="mb-3">
                  <Form.Label className="fw-medium">Email Address</Form.Label>
                  <Form.Control
                    name="email"
                    type="email"
                    placeholder="Enter your email address"
                    value={formData.email}
                    onChange={handleChange}
                    isInvalid={!!errors.email}
                    className={`${errors.email ? "border-danger" : "border-primary"} w-100 fw-medium py-2`}
                  />
                  <Form.Control.Feedback type="invalid" className="d-flex align-items-center">
                    <i className="bi bi-exclamation-circle me-1"></i>
                    {errors.email}
                  </Form.Control.Feedback>
                </Form.Group>
              )}

              {/* Password field */}
              <Form.Group className="mb-3">
                <div className="d-flex justify-content-between">
                  <Form.Label className="fw-medium">Password</Form.Label>
                  {isLogin && (
                    <Link 
                      to="/account/forgot-password" 
                      className="text-decoration-none text-primary small"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <InputGroup>
                  <Form.Control
                    name="password"
                    type="password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    isInvalid={!!errors.password}
                    className={`${errors.password ? "border-danger" : "border-primary"} w-100 fw-medium py-2`}
                  />
                </InputGroup>

                {/* Password strength indicator for signup */}
                {!isLogin && formData.password && (
                  <div className="mt-2">
                    <div className="d-flex gap-1">
                      {[1, 2, 3].map((level) => (
                        <div
                          key={level}
                          className="flex-grow-1 rounded"
                          style={{
                            height: "4px",
                            backgroundColor: passwordStrength.strength >= level
                              ? level === 1
                                ? "#ef4444"
                                : level === 2
                                  ? "#f59e0b"
                                  : "#10b981"
                              : "#e5e7eb",
                          }}
                        />
                      ))}
                    </div>
                    {passwordStrength.label && (
                      <div 
                        className="small mt-1"
                        style={{
                          color: passwordStrength.strength === 1
                            ? "#ef4444"
                            : passwordStrength.strength === 2
                              ? "#f59e0b"
                              : "#10b981"
                        }}
                      >
                        Password strength: {passwordStrength.label}
                      </div>
                    )}
                  </div>
                )}

                {errors.password && (
                  <Form.Control.Feedback type="invalid" className="d-flex align-items-center">
                    <i className="bi bi-exclamation-circle me-1"></i>
                    {errors.password}
                  </Form.Control.Feedback>
                )}
              </Form.Group>

              {/* Submit Button */}
              <Button 
                variant="primary"
                type="submit" 
                className="w-100 fw-medium py-2"
                disabled={isLoading}
                style={{
                  background: "linear-gradient(to right, #3b82f6, #8b5cf6)",
                  border: "none",
                  transition: "all 0.2s"
                }}
              >
                {isLoading ? (
                  <>
                    <Spinner
                      as="span"
                      animation="border"
                      size="sm"
                      role="status"
                      aria-hidden="true"
                      className="me-2"
                    />
                    {isLogin ? "Signing in..." : "Creating account..."}
                  </>
                ) : isLogin ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </Button>
            </Form>

            {/* Toggle between login/signup */}
            <div className="text-center mt-4 pt-3 border-top">
              <p className="text-muted mb-0">
                {isLogin 
                  ? "Don't have an account?" 
                  : "Already have an account?"}{" "}
                <Link 
                  to={isLogin ? "/account/register" : "/account/login"} 
                  className="text-decoration-none fw-medium"
                  style={{ color: "#3b82f6" }}
                >
                  {isLogin ? "Sign up" : "Sign in"}
                </Link>
              </p>
            </div>
          </Card.Body>
        </Card>

        {/* Footer */}
        <p className="text-center text-muted small mt-4">
          By continuing, you agree to our{" "}
          <Link 
            to="/terms" 
            className="text-decoration-none"
            style={{ color: "#4b5563" }}
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link 
            to="/privacy" 
            className="text-decoration-none"
            style={{ color: "#4b5563" }}
          >
            Privacy Policy
          </Link>
        </p>
      </div>
    </Container>
  );
};

export default AuthForm;