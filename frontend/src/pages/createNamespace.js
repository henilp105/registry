import React, { useState, useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { createNamespace, resetCreateNamespace } from "../store/actions/createNamespaceActions";
import { Container, Row, Col, Spinner } from "react-bootstrap";
import {
  FolderPlus,
  CheckCircleFill,
  ExclamationTriangleFill,
  InfoCircle,
  Folder2Open,
} from "react-bootstrap-icons";
import "./createNamespace.css";

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

  // Leaving the page must not leave a finished create behind (defect D85).
  useEffect(() => {
    return () => {
      dispatch(resetCreateNamespace());
    };
  }, [dispatch]);

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
          return "Only letters, numbers, underscores, and hyphens allowed";
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

  const handleChange = useCallback(
    (e) => {
      const { name, value } = e.target;
      setFormData((prev) => ({ ...prev, [name]: value }));

      if (formErrors[name]) {
        setFormErrors((prev) => ({ ...prev, [name]: null }));
      }
    },
    [formErrors]
  );

  const handleBlur = useCallback(
    (e) => {
      const { name, value } = e.target;
      setTouched((prev) => ({ ...prev, [name]: true }));
      const error = validateField(name, value);
      setFormErrors((prev) => ({ ...prev, [name]: error }));
    },
    [validateField]
  );

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      setTouched({ namespace: true, namespace_description: true });

      if (validateForm()) {
        dispatch(createNamespace({ ...formData, accessToken }));
      }
    },
    [dispatch, formData, accessToken, validateForm]
  );

  /** Validation state for a field, as a class suffix. Error wins over valid,
   *  and neither shows until the field has been blurred - so a pristine form
   *  is not a wall of red. */
  const fieldState = useCallback(
    (fieldName) => {
      if (!touched[fieldName]) return "";
      if (formErrors[fieldName]) return " --error";
      if (formData[fieldName]) return " --valid";
      return "";
    },
    [touched, formErrors, formData]
  );

  const isSuccess = statuscode === 200;

  if (isLoading) {
    return (
      <div className="namespace-page">
        <Container>
          <Row className="justify-content-center">
            <Col md={8} lg={6}>
              <div className="namespace-create-card">
                <div className="namespace-loading">
                  <Spinner animation="border" variant="primary" />
                  <span className="namespace-loading__text">
                    Creating your namespace&hellip;
                  </span>
                </div>
              </div>
            </Col>
          </Row>
        </Container>
      </div>
    );
  }

  return (
    <div className="namespace-page">
      <Container>
        <Row className="justify-content-center">
          <Col lg={7} xl={6}>
            <div className="namespace-create-card">
              {/* Header */}
              <div className="namespace-card__header">
                <div className="namespace-card__header-icon" aria-hidden="true">
                  <FolderPlus size={32} />
                </div>
                <h1 className="namespace-card__title">Create a Namespace</h1>
                <p className="namespace-card__subtitle">
                  Organize your Fortran packages under a unique namespace
                </p>
              </div>

              {/* Form Body */}
              <div className="namespace-card__body">
                {/* Alert Messages. role="alert" so the result of the submit is
                    announced rather than only appearing. */}
                {message && (
                  <div
                    className={`namespace-alert namespace-alert--${
                      isSuccess ? "success" : "error"
                    }`}
                    role="alert"
                  >
                    {isSuccess ? (
                      <CheckCircleFill size={20} />
                    ) : (
                      <ExclamationTriangleFill size={20} />
                    )}
                    <span>
                      {message}
                      {isSuccess && " Redirecting to your projects..."}
                    </span>
                  </div>
                )}

                <form onSubmit={handleSubmit} noValidate>
                  {/* Namespace Name */}
                  <div className="namespace-field">
                    <label className="namespace-label" htmlFor="namespace">
                      Namespace Name
                    </label>
                    <input
                      type="text"
                      id="namespace"
                      name="namespace"
                      className={`namespace-input${fieldState("namespace")}`}
                      placeholder="e.g., my-org, fortran-utils"
                      value={formData.namespace}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      disabled={isSuccess}
                      aria-invalid={!!(touched.namespace && formErrors.namespace)}
                      aria-describedby="namespace-help"
                    />
                    <div id="namespace-help">
                      {touched.namespace && formErrors.namespace ? (
                        <p className="namespace-error">
                          <ExclamationTriangleFill size={14} />
                          {formErrors.namespace}
                        </p>
                      ) : (
                        <p className="namespace-hint">
                          <InfoCircle size={14} />
                          Letters, numbers, underscores, and hyphens only
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <div className="namespace-field">
                    <label
                      className="namespace-label"
                      htmlFor="namespace_description"
                    >
                      Description
                    </label>
                    <textarea
                      id="namespace_description"
                      name="namespace_description"
                      className={`namespace-textarea${fieldState(
                        "namespace_description"
                      )}`}
                      placeholder="Describe what this namespace will be used for..."
                      value={formData.namespace_description}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      disabled={isSuccess}
                      aria-invalid={
                        !!(
                          touched.namespace_description &&
                          formErrors.namespace_description
                        )
                      }
                      aria-describedby="namespace-description-help"
                    />
                    <div id="namespace-description-help">
                      {touched.namespace_description &&
                      formErrors.namespace_description ? (
                        <p className="namespace-error">
                          <ExclamationTriangleFill size={14} />
                          {formErrors.namespace_description}
                        </p>
                      ) : (
                        <p className="namespace-hint">
                          <InfoCircle size={14} />
                          A clear description helps others understand your
                          namespace
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    className="namespace-submit"
                    disabled={isSuccess || isLoading}
                  >
                    {isSuccess ? (
                      <>
                        <CheckCircleFill size={20} />
                        Namespace Created!
                      </>
                    ) : (
                      <>
                        <FolderPlus size={20} />
                        Create Namespace
                      </>
                    )}
                  </button>
                </form>

                {/* Info Card */}
                <div className="namespace-info">
                  <div className="namespace-info__title">
                    <InfoCircle size={16} />
                    What happens next?
                  </div>
                  <ul className="namespace-info__list">
                    <li>
                      <CheckCircleFill size={12} />
                      <span>You&apos;ll become the admin of this namespace</span>
                    </li>
                    <li>
                      <CheckCircleFill size={12} />
                      <span>You can add maintainers to help manage packages</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </Col>

          {/* Sidebar */}
          <Col lg={4} xl={4} className="d-none d-lg-block">
            <aside className="namespace-side">
              <div className="namespace-side__title">
                <Folder2Open size={20} />
                What is a Namespace?
              </div>
              <p className="namespace-side__text">
                A namespace is a container for your Fortran packages. It helps
                organize related packages and prevents naming conflicts with
                other packages in the registry.
              </p>
            </aside>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default NamespaceForm;
