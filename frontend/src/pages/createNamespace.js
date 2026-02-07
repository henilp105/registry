import React, { useState, useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import { createNamespace } from "../store/actions/createNamespaceActions";
import { Container, Row, Col, Spinner } from "react-bootstrap";
import { 
  FolderPlus, 
  CheckCircleFill, 
  ExclamationTriangleFill,
  InfoCircle,
  BoxSeam,
  ArrowRight,
  Folder2Open
} from "react-bootstrap-icons";

// Styles for the create namespace page
const styles = {
  pageContainer: {
    minHeight: "calc(100vh - 120px)",
    background: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)",
    padding: "3rem 1rem",
  },
  card: {
    background: "#ffffff",
    borderRadius: "20px",
    boxShadow: "0 10px 40px rgba(0, 0, 0, 0.08)",
    border: "1px solid #e5e7eb",
    overflow: "hidden",
  },
  header: {
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    padding: "2.5rem 2rem",
    textAlign: "center",
    color: "#ffffff",
  },
  headerIcon: {
    width: "64px",
    height: "64px",
    background: "rgba(255, 255, 255, 0.2)",
    borderRadius: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 1rem",
    backdropFilter: "blur(10px)",
  },
  headerTitle: {
    fontSize: "1.75rem",
    fontWeight: "700",
    marginBottom: "0.5rem",
  },
  headerSubtitle: {
    fontSize: "1rem",
    opacity: "0.9",
  },
  formBody: {
    padding: "2rem",
  },
  inputGroup: {
    marginBottom: "1.5rem",
  },
  label: {
    display: "block",
    fontSize: "0.875rem",
    fontWeight: "600",
    color: "#374151",
    marginBottom: "0.5rem",
  },
  input: {
    width: "100%",
    padding: "0.875rem 1rem",
    fontSize: "1rem",
    border: "2px solid #e5e7eb",
    borderRadius: "12px",
    transition: "all 0.2s ease",
    outline: "none",
  },
  inputFocused: {
    borderColor: "#6366f1",
    boxShadow: "0 0 0 3px rgba(99, 102, 241, 0.1)",
  },
  inputError: {
    borderColor: "#ef4444",
    boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.1)",
  },
  inputSuccess: {
    borderColor: "#10b981",
    boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
  },
  textarea: {
    width: "100%",
    padding: "0.875rem 1rem",
    fontSize: "1rem",
    border: "2px solid #e5e7eb",
    borderRadius: "12px",
    transition: "all 0.2s ease",
    outline: "none",
    resize: "vertical",
    minHeight: "120px",
  },
  helpText: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.8rem",
    color: "#6b7280",
    marginTop: "0.5rem",
  },
  errorText: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.8rem",
    color: "#ef4444",
    marginTop: "0.5rem",
  },
  submitButton: {
    width: "100%",
    padding: "1rem 1.5rem",
    fontSize: "1rem",
    fontWeight: "600",
    color: "#ffffff",
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
  },
  submitButtonDisabled: {
    opacity: "0.6",
    cursor: "not-allowed",
  },
  alert: {
    padding: "1rem 1.25rem",
    borderRadius: "12px",
    marginBottom: "1.5rem",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  alertSuccess: {
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    color: "#065f46",
  },
  alertError: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
  },
  infoCard: {
    background: "#f8fafc",
    borderRadius: "12px",
    padding: "1.25rem",
    marginTop: "1.5rem",
    border: "1px solid #e2e8f0",
  },
  infoCardTitle: {
    fontSize: "0.875rem",
    fontWeight: "600",
    color: "#374151",
    marginBottom: "0.75rem",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  infoList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  infoListItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    fontSize: "0.8rem",
    color: "#6b7280",
    marginBottom: "0.5rem",
  },
  loadingContainer: {
    minHeight: "400px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
  },
  loadingText: {
    color: "#6b7280",
    fontSize: "1rem",
  },
  sideCard: {
    background: "#ffffff",
    borderRadius: "16px",
    padding: "1.5rem",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.06)",
    border: "1px solid #e5e7eb",
    marginBottom: "1.5rem",
  },
  sideCardTitle: {
    fontSize: "1rem",
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: "0.75rem",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  sideCardText: {
    fontSize: "0.875rem",
    color: "#6b7280",
    lineHeight: "1.6",
  },
  linkButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    color: "#6366f1",
    fontSize: "0.875rem",
    fontWeight: "500",
    textDecoration: "none",
    marginTop: "0.75rem",
  },
};

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
  const [focused, setFocused] = useState({});

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

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: null }));
    }
  }, [formErrors]);

  const handleBlur = useCallback((e) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    setFocused((prev) => ({ ...prev, [name]: false }));
    const error = validateField(name, value);
    setFormErrors((prev) => ({ ...prev, [name]: error }));
  }, [validateField]);

  const handleFocus = useCallback((e) => {
    const { name } = e.target;
    setFocused((prev) => ({ ...prev, [name]: true }));
  }, []);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    setTouched({ namespace: true, namespace_description: true });
    
    if (validateForm()) {
      dispatch(createNamespace({ ...formData, accessToken }));
    }
  }, [dispatch, formData, accessToken, validateForm]);

  const getInputStyle = (fieldName) => {
    let style = { ...styles.input };
    if (touched[fieldName] && formErrors[fieldName]) {
      style = { ...style, ...styles.inputError };
    } else if (touched[fieldName] && !formErrors[fieldName] && formData[fieldName]) {
      style = { ...style, ...styles.inputSuccess };
    } else if (focused[fieldName]) {
      style = { ...style, ...styles.inputFocused };
    }
    return style;
  };

  const getTextareaStyle = (fieldName) => {
    let style = { ...styles.textarea };
    if (touched[fieldName] && formErrors[fieldName]) {
      style = { ...style, ...styles.inputError };
    } else if (touched[fieldName] && !formErrors[fieldName] && formData[fieldName]) {
      style = { ...style, ...styles.inputSuccess };
    } else if (focused[fieldName]) {
      style = { ...style, ...styles.inputFocused };
    }
    return style;
  };

  const isSuccess = statuscode === 200;

  if (isLoading) {
    return (
      <div style={styles.pageContainer}>
        <Container>
          <Row className="justify-content-center">
            <Col md={8} lg={6}>
              <div style={{ ...styles.card }}>
                <div style={styles.loadingContainer}>
                  <Spinner animation="border" style={{ color: "#6366f1" }} />
                  <span style={styles.loadingText}>Creating your namespace...</span>
                </div>
              </div>
            </Col>
          </Row>
        </Container>
      </div>
    );
  }

  return (
    <div style={styles.pageContainer}>
      <Container>
        <Row className="justify-content-center">
          <Col lg={7} xl={6}>
            <div style={styles.card}>
              {/* Header */}
              <div style={styles.header}>
                <div style={styles.headerIcon}>
                  <FolderPlus size={32} />
                </div>
                <h1 style={styles.headerTitle}>Create a Namespace</h1>
                <p style={styles.headerSubtitle}>
                  Organize your Fortran packages under a unique namespace
                </p>
              </div>

              {/* Form Body */}
              <div style={styles.formBody}>
                {/* Alert Messages */}
                {message && (
                  <div style={{ 
                    ...styles.alert, 
                    ...(isSuccess ? styles.alertSuccess : styles.alertError) 
                  }}>
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

                <form onSubmit={handleSubmit}>
                  {/* Namespace Name */}
                  <div style={styles.inputGroup}>
                    <label style={styles.label} htmlFor="namespace">
                      Namespace Name
                    </label>
                    <input
                      type="text"
                      id="namespace"
                      name="namespace"
                      placeholder="e.g., my-org, fortran-utils"
                      value={formData.namespace}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      onFocus={handleFocus}
                      disabled={isSuccess}
                      style={getInputStyle("namespace")}
                    />
                    {touched.namespace && formErrors.namespace ? (
                      <div style={styles.errorText}>
                        <ExclamationTriangleFill size={14} />
                        {formErrors.namespace}
                      </div>
                    ) : (
                      <div style={styles.helpText}>
                        <InfoCircle size={14} />
                        Letters, numbers, underscores, and hyphens only
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <div style={styles.inputGroup}>
                    <label style={styles.label} htmlFor="namespace_description">
                      Description
                    </label>
                    <textarea
                      id="namespace_description"
                      name="namespace_description"
                      placeholder="Describe what this namespace will be used for..."
                      value={formData.namespace_description}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      onFocus={handleFocus}
                      disabled={isSuccess}
                      style={getTextareaStyle("namespace_description")}
                    />
                    {touched.namespace_description && formErrors.namespace_description ? (
                      <div style={styles.errorText}>
                        <ExclamationTriangleFill size={14} />
                        {formErrors.namespace_description}
                      </div>
                    ) : (
                      <div style={styles.helpText}>
                        <InfoCircle size={14} />
                        A clear description helps others understand your namespace
                      </div>
                    )}
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isSuccess || isLoading}
                    style={{
                      ...styles.submitButton,
                      ...(isSuccess ? styles.submitButtonDisabled : {}),
                    }}
                    onMouseOver={(e) => {
                      if (!isSuccess) {
                        e.currentTarget.style.transform = "translateY(-2px)";
                        e.currentTarget.style.boxShadow = "0 6px 20px rgba(99, 102, 241, 0.4)";
                      }
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
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
                <div style={styles.infoCard}>
                  <div style={styles.infoCardTitle}>
                    <InfoCircle size={16} style={{ color: "#6366f1" }} />
                    What happens next?
                  </div>
                  <ul style={styles.infoList}>
                    <li style={styles.infoListItem}>
                      <CheckCircleFill size={12} style={{ color: "#10b981", marginTop: "2px" }} />
                      <span>You'll become the admin of this namespace</span>
                    </li>
                    <li style={styles.infoListItem}>
                      <CheckCircleFill size={12} style={{ color: "#10b981", marginTop: "2px" }} />
                      <span>You can add maintainers to help manage packages</span>
                    </li>
                    <li style={styles.infoListItem}>
                      <CheckCircleFill size={12} style={{ color: "#10b981", marginTop: "2px" }} />
                      <span>Upload packages using fpm or the web interface</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </Col>

          {/* Sidebar */}
          <Col lg={4} xl={4} className="d-none d-lg-block">
            <div style={styles.sideCard}>
              <div style={styles.sideCardTitle}>
                <Folder2Open size={20} style={{ color: "#6366f1" }} />
                What is a Namespace?
              </div>
              <p style={styles.sideCardText}>
                A namespace is a container for your Fortran packages. It helps organize 
                related packages and prevents naming conflicts with other packages in the registry.
              </p>
            </div>

            <div style={styles.sideCard}>
              <div style={styles.sideCardTitle}>
                <BoxSeam size={20} style={{ color: "#10b981" }} />
                Ready to Upload?
              </div>
              <p style={styles.sideCardText}>
                After creating your namespace, you can start uploading packages right away 
                using the fpm CLI or our web upload interface.
              </p>
              <Link to="/upload" style={styles.linkButton}>
                Learn about uploading
                <ArrowRight size={16} />
              </Link>
            </div>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default NamespaceForm;
