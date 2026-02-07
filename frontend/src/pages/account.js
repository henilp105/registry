import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  reset,
  getUserAccount,
  resetMessages,
  change,
} from "../store/actions/accountActions";

import Row from "react-bootstrap/Row";
import Modal from "react-bootstrap/Modal";
import Col from "react-bootstrap/Col";
import Spinner from "react-bootstrap/Spinner";
import Container from "react-bootstrap/Container";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import { 
  PersonCircle, 
  CalendarEvent, 
  Envelope, 
  Key, 
  PencilSquare,
  ShieldLock,
  At
} from "react-bootstrap-icons";

import "bootstrap/dist/css/bootstrap.min.css";
import "./account.css";

const Account = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Auth state
  const accessToken = useSelector((state) => state.auth.accessToken);
  const username = useSelector((state) => state.auth.username);

  // Account state
  const email = useSelector((state) => state.account.email);
  const dateJoined = useSelector((state) => state.account.dateJoined);
  const error = useSelector((state) => state.account.error);
  const message = useSelector((state) => state.account.message);
  const isLoading = useSelector((state) => state.account.isLoading);
  const isLoadingEmail = useSelector((state) => state.account.isLoadingEmail);
  const isLoadingPassword = useSelector((state) => state.account.isLoadingPassword);

  // Form state
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [formErrors, setFormErrors] = useState({});

  // Modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);

  // Format date
  const formattedDate = useMemo(() => {
    if (!dateJoined) return null;
    return new Date(dateJoined).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [dateJoined]);

  // Redirect if not logged in, fetch account data on mount
  useEffect(() => {
    if (!username) {
      navigate("/");
    } else {
      dispatch(getUserAccount(accessToken));
    }
  }, [username, accessToken, dispatch, navigate]);

  // Clear form and messages
  const clearForm = useCallback(() => {
    setFormErrors({});
    setNewEmail("");
    setNewPassword("");
    setOldPassword("");
    dispatch(resetMessages());
  }, [dispatch]);

  // Password validation
  const validatePasswordForm = () => {
    const errors = {};
    if (!oldPassword) {
      errors.oldPassword = "Old password is required";
    }
    if (!newPassword) {
      errors.newPassword = "New password is required";
    } else if (newPassword.length < 8) {
      errors.newPassword = "Password must be at least 8 characters";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Email validation
  const validateEmailForm = () => {
    const errors = {};
    if (!newEmail) {
      errors.email = "New email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      errors.email = "Please enter a valid email address";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle password reset
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (validatePasswordForm()) {
      dispatch(resetMessages());
      dispatch(reset(oldPassword, newPassword, accessToken));
      setNewPassword("");
      setOldPassword("");
    }
  };

  // Handle email change
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (validateEmailForm()) {
      dispatch(resetMessages());
      dispatch(change(newEmail, accessToken));
      setNewEmail("");
    }
  };

  // Modal handlers
  const handleOpenPasswordModal = () => {
    clearForm();
    setShowPasswordModal(true);
  };

  const handleClosePasswordModal = () => {
    clearForm();
    setShowPasswordModal(false);
  };

  const handleOpenEmailModal = () => {
    clearForm();
    setShowEmailModal(true);
  };

  const handleCloseEmailModal = () => {
    clearForm();
    setShowEmailModal(false);
  };

  // Loading state
  if (isLoading) {
    return (
      <Container className="account-loading">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
        <p className="account-loading-text">Loading account settings...</p>
      </Container>
    );
  }

  return (
    <Container className="account-container">
      <Row className="g-4">
        {/* Sidebar - Profile Card */}
        <Col lg={4} md={5}>
          <div className="account-sidebar">
            <div className="account-card">
              <img
                className="account-avatar"
                alt={`Avatar for ${username}`}
                src={`https://www.gravatar.com/avatar/${username}?d=identicon&s=200`}
              />
              
              <h1 className="account-username">@{username}</h1>
              
              <p className="account-gravatar-note">
                Profile picture powered by{" "}
                <a href="https://gravatar.com" target="_blank" rel="noopener noreferrer">
                  Gravatar
                </a>
              </p>

              <div className="account-quick-actions">
                <button 
                  className="account-action-btn"
                  onClick={handleOpenPasswordModal}
                >
                  <Key className="action-icon" />
                  <span>Change Password</span>
                </button>
                <button 
                  className="account-action-btn"
                  onClick={handleOpenEmailModal}
                >
                  <PencilSquare className="action-icon" />
                  <span>Change Email</span>
                </button>
              </div>
            </div>
          </div>
        </Col>

        {/* Main Content - Account Details */}
        <Col lg={8} md={7}>
          <div className="account-details-section">
            <div className="account-section-header">
              <h2 className="account-section-title">Account Settings</h2>
              <span className="account-badge">
                <ShieldLock size={14} />
                Verified Account
              </span>
            </div>

            <div className="account-info-grid">
              <div className="account-info-card">
                <div className="account-info-icon-wrapper">
                  <At size={24} />
                </div>
                <div className="account-info-content">
                  <span className="account-info-label">Username</span>
                  <span className="account-info-value">@{username}</span>
                </div>
              </div>

              <div className="account-info-card">
                <div className="account-info-icon-wrapper">
                  <CalendarEvent size={24} />
                </div>
                <div className="account-info-content">
                  <span className="account-info-label">Member Since</span>
                  <span className="account-info-value">{formattedDate || dateJoined}</span>
                </div>
              </div>

              <div className="account-info-card account-info-card-full">
                <div className="account-info-icon-wrapper">
                  <Envelope size={24} />
                </div>
                <div className="account-info-content">
                  <span className="account-info-label">Primary Email</span>
                  <span className="account-info-value account-email">{email}</span>
                </div>
                <button 
                  className="account-edit-btn"
                  onClick={handleOpenEmailModal}
                  title="Edit email"
                >
                  <PencilSquare size={16} />
                </button>
              </div>

              <div className="account-info-card account-info-card-full">
                <div className="account-info-icon-wrapper">
                  <Key size={24} />
                </div>
                <div className="account-info-content">
                  <span className="account-info-label">Password</span>
                  <span className="account-info-value">••••••••••</span>
                </div>
                <button 
                  className="account-edit-btn"
                  onClick={handleOpenPasswordModal}
                  title="Change password"
                >
                  <PencilSquare size={16} />
                </button>
              </div>
            </div>

            <div className="account-profile-link">
              <PersonCircle size={20} />
              <span>View your public profile at</span>
              <a href={`/users/${username}`}>
                /users/{username}
              </a>
            </div>
          </div>
        </Col>
      </Row>

      {/* Password Reset Modal */}
      <Modal show={showPasswordModal} onHide={handleClosePasswordModal} centered className="account-modal">
        <Modal.Header closeButton>
          <Modal.Title>
            <Key className="me-2" />
            Change Password
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handlePasswordSubmit}>
            <Form.Group className="mb-4">
              <Form.Label className="account-form-label">Current Password</Form.Label>
              <Form.Control
                type="password"
                placeholder="Enter your current password"
                name="oldPassword"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                isInvalid={!!formErrors.oldPassword}
                className="account-form-input"
              />
              <Form.Control.Feedback type="invalid">
                {formErrors.oldPassword}
              </Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label className="account-form-label">New Password</Form.Label>
              <Form.Control
                type="password"
                placeholder="Enter your new password"
                name="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                isInvalid={!!formErrors.newPassword}
                className="account-form-input"
              />
              <Form.Control.Feedback type="invalid">
                {formErrors.newPassword}
              </Form.Control.Feedback>
              <Form.Text className="text-muted">
                Password must be at least 8 characters long
              </Form.Text>
            </Form.Group>

            {error && (
              <Alert variant="danger" className="mt-3 account-alert">
                {error}
              </Alert>
            )}
            {message && (
              <Alert variant="success" className="mt-3 account-alert">
                {message}
              </Alert>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer className="account-modal-footer">
          <Button variant="outline-secondary" onClick={handleClosePasswordModal}>
            Cancel
          </Button>
          <Button 
            className="account-submit-btn"
            onClick={handlePasswordSubmit}
            disabled={isLoadingPassword}
          >
            {isLoadingPassword ? (
              <>
                <Spinner size="sm" animation="border" className="me-2" />
                Updating...
              </>
            ) : (
              "Update Password"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Change Email Modal */}
      <Modal show={showEmailModal} onHide={handleCloseEmailModal} centered className="account-modal">
        <Modal.Header closeButton>
          <Modal.Title>
            <Envelope className="me-2" />
            Change Email
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleEmailSubmit}>
            <Form.Group className="mb-3">
              <Form.Label className="account-form-label">New Email Address</Form.Label>
              <Form.Control
                type="email"
                placeholder="Enter your new email address"
                name="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                isInvalid={!!formErrors.email}
                className="account-form-input"
              />
              <Form.Control.Feedback type="invalid">
                {formErrors.email}
              </Form.Control.Feedback>
              <Form.Text className="text-muted">
                A verification email will be sent to your new address
              </Form.Text>
            </Form.Group>

            {error && (
              <Alert variant="danger" className="mt-3 account-alert">
                {error}
              </Alert>
            )}
            {message && (
              <Alert variant="success" className="mt-3 account-alert">
                {message}
              </Alert>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer className="account-modal-footer">
          <Button variant="outline-secondary" onClick={handleCloseEmailModal}>
            Cancel
          </Button>
          <Button 
            className="account-submit-btn"
            onClick={handleEmailSubmit}
            disabled={isLoadingEmail}
          >
            {isLoadingEmail ? (
              <>
                <Spinner size="sm" animation="border" className="me-2" />
                Updating...
              </>
            ) : (
              "Update Email"
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Account;
