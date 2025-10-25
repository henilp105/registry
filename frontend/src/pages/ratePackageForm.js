import React, { useEffect, useState, useCallback } from "react";
import { Form, Button, Modal, Spinner, Alert } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import {
  ratePackage,
  resetErrorMessage,
} from "../store/actions/ratePackageActions";

const RATING_OPTIONS = [
  { value: 1, label: "1 - Poor" },
  { value: 2, label: "2 - Fair" },
  { value: 3, label: "3 - Good" },
  { value: 4, label: "4 - Very Good" },
  { value: 5, label: "5 - Excellent" },
];

const RatePackageForm = ({ namespace, package: packageName, show, onHide }) => {
  const dispatch = useDispatch();
  const [rating, setRating] = useState("");
  const [validationError, setValidationError] = useState("");
  
  const accessToken = useSelector((state) => state.auth.accessToken);
  const { isLoading, statuscode, message } = useSelector(
    (state) => state.ratePackage
  );

  const isSuccess = statuscode === 200;

  const validateRating = useCallback((value) => {
    if (!value) return "Please select a rating";
    const num = parseInt(value, 10);
    if (num < 1 || num > 5) return "Rating must be between 1 and 5";
    return null;
  }, []);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    const error = validateRating(rating);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError("");
    dispatch(
      ratePackage(
        { rating, namespace, package: packageName },
        accessToken
      )
    );
  }, [dispatch, rating, namespace, packageName, accessToken, validateRating]);

  const resetData = useCallback(() => {
    setRating("");
    setValidationError("");
    dispatch(resetErrorMessage());
  }, [dispatch]);

  // Auto-close on success after delay
  useEffect(() => {
    if (isSuccess && show) {
      const timer = setTimeout(() => {
        onHide();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, show, onHide]);

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="md"
      aria-labelledby="rate-package-modal"
      centered
      onExited={resetData}
    >
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title id="rate-package-modal">Rate Package</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">
            Rate <strong>{namespace}/{packageName}</strong>
          </p>

          <Form.Group className="mb-3">
            <Form.Label>Rating</Form.Label>
            <Form.Select
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              isInvalid={!!validationError}
              disabled={isLoading || isSuccess}
            >
              <option value="">Select a rating...</option>
              {RATING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Form.Select>
            <Form.Control.Feedback type="invalid">
              {validationError}
            </Form.Control.Feedback>
          </Form.Group>

          {message && (
            <Alert variant={isSuccess ? "success" : "danger"} className="mb-0">
              {isSuccess && <i className="fas fa-check-circle me-2" />}
              {!isSuccess && <i className="fas fa-exclamation-circle me-2" />}
              {message}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isLoading || isSuccess}
          >
            {isLoading ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Submitting...
              </>
            ) : isSuccess ? (
              <>
                <i className="fas fa-check me-2" />
                Rated
              </>
            ) : (
              <>
                <i className="fas fa-star me-2" />
                Submit Rating
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default RatePackageForm;
