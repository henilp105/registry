import React, { useEffect, useState, useCallback } from "react";
import { Form, Button, Modal, Spinner, Alert } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import {
  reportPackage,
  resetErrorMessage,
} from "../store/actions/reportPackageActions";

const ReportPackageForm = ({ namespace, package: packageName, show, onHide }) => {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState("");
  const [touched, setTouched] = useState(false);
  
  const accessToken = useSelector((state) => state.auth.accessToken);
  const { isLoading, statuscode, message } = useSelector(
    (state) => state.reportPackage
  );

  const isSuccess = statuscode === 200;

  const validateReason = useCallback((value) => {
    if (!value.trim()) return "Please provide a reason for reporting";
    if (value.length < 20) return "Reason must be at least 20 characters";
    return null;
  }, []);

  const handleBlur = useCallback(() => {
    setTouched(true);
    setValidationError(validateReason(reason));
  }, [reason, validateReason]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    setTouched(true);
    
    const error = validateReason(reason);
    if (error) {
      setValidationError(error);
      return;
    }
    
    dispatch(
      reportPackage(
        { reason, namespace, package: packageName },
        accessToken
      )
    );
  }, [dispatch, reason, namespace, packageName, accessToken, validateReason]);

  const resetData = useCallback(() => {
    setReason("");
    setValidationError("");
    setTouched(false);
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
      size="lg"
      aria-labelledby="report-package-modal"
      centered
      onExited={resetData}
    >
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title id="report-package-modal">Report Package</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="mb-3">
            <i className="fas fa-exclamation-triangle me-2" />
            You are about to report <strong>{namespace}/{packageName}</strong>.
            Please provide a detailed reason.
          </Alert>

          <Form.Group className="mb-3">
            <Form.Label>Reason for Report</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              placeholder="Describe why you are reporting this package..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={handleBlur}
              isInvalid={touched && !!validationError}
              disabled={isLoading || isSuccess}
            />
            <Form.Control.Feedback type="invalid">
              {validationError}
            </Form.Control.Feedback>
            <Form.Text className="text-muted">
              Be specific about the issue (e.g., malicious code, license violation, spam).
            </Form.Text>
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
            variant="danger"
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
                Reported
              </>
            ) : (
              <>
                <i className="fas fa-flag me-2" />
                Submit Report
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default ReportPackageForm;
