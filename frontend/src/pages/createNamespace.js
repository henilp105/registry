import React, { useState, useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { createNamespace } from "../store/actions/createNamespaceActions";
import Spinner from "react-bootstrap/Spinner";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Card from "react-bootstrap/Card";
import Alert from "react-bootstrap/Alert";

const NamespaceForm = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const accessToken = useSelector((state) => state.auth.accessToken);
  const { isLoading, message, statuscode } = useSelector(
    (state) => state.createNamespace
  );

  const [formData, setFormData] = useState({
    namespace: "",
    namespace_description: "",
  });
  const [formErrors, setFormErrors] = useState({});
  const [touched, setTouched] = useState({});

  // Redirect if not authenticated
  useEffect(() => {
    if (accessToken === null) {
      navigate("/");
    }
  }, [accessToken, navigate]);

  // Handle success - redirect after delay
  useEffect(() => {
    if (statuscode === 200) {
      const timer = setTimeout(() => {
        navigate("/manage/projects");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [statuscode, navigate]);

  const validateField = useCallback((name, value) => {
    switch (name) {
      case "namespace":
        if (!value.trim()) return "Namespace name is required";
        if (value.length < 2) return "Namespace must be at least 2 characters";
        if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
          return "Namespace can only contain letters, numbers, underscores, and hyphens";
        }
        return null;
      case "namespace_description":
        if (!value.trim()) return "Description is required";
        if (value.length < 10) return "Description must be at least 10 characters";
        return null;
      default:
        return null;
    }
  }, []);

  const validateForm = useCallback(() => {
    const errors = {};
    Object.keys(formData).forEach((field) => {
      const error = validateField(field, formData[field]);
      if (error) errors[field] = error;
    });
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData, validateField]);

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    
    // Clear error when user starts typing
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: null }));
    }
  }, [formErrors]);

  const handleBlur = useCallback((e) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    const error = validateField(name, value);
    setFormErrors((prev) => ({ ...prev, [name]: error }));
  }, [validateField]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    setTouched({ namespace: true, namespace_description: true });
    
    if (validateForm()) {
      dispatch(createNamespace({ ...formData, accessToken }));
    }
  }, [dispatch, formData, accessToken, validateForm]);

  const isSuccess = statuscode === 200;

  if (isLoading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "300px" }}>
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Creating namespace...</span>
        </Spinner>
      </div>
    );
  }

  return (
    <Card id="create-namespace-card" className="mx-auto" style={{ maxWidth: "500px", marginTop: "2rem" }}>
      <Card.Body>
        <h3 className="mb-4">Create a Namespace</h3>

        {message && (
          <Alert variant={isSuccess ? "success" : "danger"} className="mb-3">
            {isSuccess && <i className="fas fa-check-circle me-2" />}
            {!isSuccess && <i className="fas fa-exclamation-circle me-2" />}
            {message}
            {isSuccess && <span className="ms-2">Redirecting...</span>}
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3" controlId="formNamespaceName">
            <Form.Label>Namespace Name</Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter namespace name"
              value={formData.namespace}
              name="namespace"
              onChange={handleChange}
              onBlur={handleBlur}
              isInvalid={touched.namespace && !!formErrors.namespace}
              disabled={isSuccess}
            />
            <Form.Control.Feedback type="invalid">
              {formErrors.namespace}
            </Form.Control.Feedback>
            <Form.Text className="text-muted">
              Choose a unique namespace name (letters, numbers, underscores, hyphens).
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3" controlId="formNamespaceDescription">
            <Form.Label>Description</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              placeholder="Enter namespace description"
              name="namespace_description"
              value={formData.namespace_description}
              onChange={handleChange}
              onBlur={handleBlur}
              isInvalid={touched.namespace_description && !!formErrors.namespace_description}
              disabled={isSuccess}
            />
            <Form.Control.Feedback type="invalid">
              {formErrors.namespace_description}
            </Form.Control.Feedback>
            <Form.Text className="text-muted">
              Describe what this namespace will be used for.
            </Form.Text>
          </Form.Group>

          <Button 
            variant="primary" 
            type="submit" 
            className="w-100"
            disabled={isSuccess}
          >
            {isSuccess ? (
              <>
                <i className="fas fa-check me-2" />
                Namespace Created
              </>
            ) : (
              "Create Namespace"
            )}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
};

export default NamespaceForm;
