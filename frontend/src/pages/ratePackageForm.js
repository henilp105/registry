import React, { useEffect, useState, useCallback, useRef } from "react";
import { Form, Button, Modal, Spinner, Alert } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import {
  ratePackage,
  resetErrorMessage,
} from "../store/actions/ratePackageActions";
import Icon from "../components/Icon";

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
  const { isLoading, statuscode, message, error } = useSelector(
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

  // Auto-close on success after delay. onHide lives in a ref: the parent
  // passes a fresh inline closure on every render, which would otherwise
  // reset the countdown and the dialog would never dismiss (D84).
  const onHideRef = useRef(onHide);
  useEffect(() => {
    onHideRef.current = onHide;
  }, [onHide]);

  useEffect(() => {
    if (isSuccess && show) {
      const timer = setTimeout(() => {
        onHideRef.current();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, show]);

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

          <Form.Group className="mb-3" controlId="ratepackage-rating">
            {/* Defect D104: `controlId` is what ties the <label> to the control.
              Without it react-bootstrap renders a bare <label> with no
              `for` and the control has no `id`, so the field has no
              accessible name -- announced only as "edit text" -- and
              clicking the visible label does not focus it. Every other
              form in the app (account.js, resetpassword.js, login.js)
              passes it; these were the ones missed. Plain HTML ids, so
              the association is assertable in CI: see
              scripts/check_form_labels.mjs. */}
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

          {(message || error) && (
            <Alert variant={isSuccess ? "success" : "danger"} className="mb-0">
              {isSuccess && <Icon name="check-circle" className="me-2" />}
              {!isSuccess && <Icon name="exclamation-circle" className="me-2" />}
              {message || error}
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
                <Icon name="check" className="me-2" />
                Rated
              </>
            ) : (
              <>
                <Icon name="star" className="me-2" />
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
