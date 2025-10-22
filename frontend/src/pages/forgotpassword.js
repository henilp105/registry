import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { forgot } from "../store/actions/resetPasswordActions";
import { Link } from "react-router-dom";
import Container from "react-bootstrap/Container";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";

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

  return (
    <Container 
      className="d-flex justify-content-center" 
      style={{ paddingTop: 50 }}
    >
      <div style={{ width: "100%", maxWidth: "400px" }}>
        <h1 className="mb-2">Forgot Password?</h1>
        <p className="text-muted mb-4">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {message && (
          <Alert variant={isSuccess ? "success" : "danger"} className="mb-3">
            {isSuccess && <i className="fas fa-check-circle me-2" />}
            {!isSuccess && <i className="fas fa-exclamation-circle me-2" />}
            {message}
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Email address</Form.Label>
            <Form.Control
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={handleBlur}
              isInvalid={touched && !!formErrors.email}
              disabled={isLoading}
            />
            <Form.Control.Feedback type="invalid">
              {formErrors.email}
            </Form.Control.Feedback>
          </Form.Group>

          <Button
            type="submit"
            variant="primary"
            className="w-100 mb-3"
            disabled={isLoading}
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
                Sending...
              </>
            ) : (
              "Send Reset Link"
            )}
          </Button>
        </Form>

        <p className="text-center text-muted">
          Remember your password? <Link to="/account/login">Login</Link>
        </p>
      </div>
    </Container>
  );
};

export default ForgotPassword;
