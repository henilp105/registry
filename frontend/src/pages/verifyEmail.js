import React, { useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { verify } from "../store/actions/verifyEmailActions";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";

const VerifyEmail = () => {
  const { uuid } = useParams();
  const dispatch = useDispatch();
  
  const { message, statuscode, isLoading } = useSelector(
    (state) => state.verifyEmail
  );

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    dispatch(verify(uuid));
  }, [dispatch, uuid]);

  const isSuccess = statuscode === 200;

  return (
    <Container 
      className="d-flex justify-content-center" 
      style={{ paddingTop: 50 }}
    >
      <div style={{ width: "100%", maxWidth: "400px" }}>
        <h1 className="mb-3">Welcome to fpm Registry!</h1>
        <p className="text-muted mb-4">
          Click the button below to verify your email address.
        </p>

        <form onSubmit={handleSubmit}>
          <Button
            type="submit"
            variant={isSuccess ? "success" : "primary"}
            size="lg"
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
                Verifying...
              </>
            ) : isSuccess ? (
              <>
                <i className="fas fa-check me-2" />
                Email Verified
              </>
            ) : (
              "Verify Email"
            )}
          </Button>

          {message && (
            <Alert variant={isSuccess ? "success" : "danger"} className="mb-3">
              {isSuccess && <i className="fas fa-check-circle me-2" />}
              {!isSuccess && <i className="fas fa-exclamation-circle me-2" />}
              {message}
            </Alert>
          )}
        </form>

        <p className="text-center text-muted">
          Already have an account? <Link to="/account/login">Login</Link>
        </p>
      </div>
    </Container>
  );
};

export default VerifyEmail;
