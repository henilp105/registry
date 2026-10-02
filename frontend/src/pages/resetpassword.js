import React, { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { reset } from "../store/actions/resetPasswordActions";
import Container from "react-bootstrap/Container";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";
import InputGroup from "react-bootstrap/InputGroup";
import Icon from "../components/Icon";

const ResetPassword = () => {
  const { uuid } = useParams();
  const dispatch = useDispatch();
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [touched, setTouched] = useState({});
  
  const { message, statuscode, isLoading } = useSelector(
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

  return (
    <Container className="auth-narrow-page">
      <div>
        <h1 className="mb-2">Reset Password</h1>
        <p className="text-muted mb-4">
          Enter your new password below.
        </p>

        {message && (
          <Alert variant={isSuccess ? "success" : "danger"} className="mb-3">
            {isSuccess && <Icon name="check-circle" className="me-2" />}
            {!isSuccess && <Icon name="exclamation-circle" className="me-2" />}
            {message}
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          {/* `controlId` is what associates the label with the control.
              react-bootstrap's Form.Label renders a bare <label>, and without a
              controlId on the group it has no `for`, so a screen reader announces
              an unlabelled password field. This is the only form in the app with
              the omission, which is why it survived the earlier a11y pass. */}
          <Form.Group className="mb-3" controlId="reset-password">
            <Form.Label>New Password</Form.Label>
            <InputGroup>
              <Form.Control
                type={showPassword ? "text" : "password"}
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur("password")}
                isInvalid={touched.password && !!formErrors.password}
                disabled={isLoading}
              />
              {/* An icon-only button announced simply as "button", and
                  `tabIndex={-1}` put it beyond the reach of a keyboard user
                  entirely. It is now labelled, exposes its pressed state, and is
                  focusable: saving a keystroke in the tab order is not worth
                  making a control unreachable. */}
              <Button
                variant="outline-secondary"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                <Icon name={showPassword ? "eye-slash" : "eye"} />
              </Button>
              <Form.Control.Feedback type="invalid">
                {formErrors.password}
              </Form.Control.Feedback>
            </InputGroup>
          </Form.Group>

          <Form.Group className="mb-3" controlId="reset-password-confirm">
            <Form.Label>Confirm Password</Form.Label>
            <Form.Control
              type={showPassword ? "text" : "password"}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => handleBlur("confirmPassword")}
              isInvalid={touched.confirmPassword && !!formErrors.confirmPassword}
              disabled={isLoading}
            />
            <Form.Control.Feedback type="invalid">
              {formErrors.confirmPassword}
            </Form.Control.Feedback>
          </Form.Group>

          <Button
            type="submit"
            variant="primary"
            className="w-100 mb-3"
            disabled={isLoading || isSuccess}
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
                Resetting...
              </>
            ) : isSuccess ? (
              <>
                <Icon name="check" className="me-2" />
                Password Reset
              </>
            ) : (
              "Reset Password"
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

export default ResetPassword;
