import React, { useEffect, useState, useCallback } from "react";
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
import Image from "react-bootstrap/Image";
import Table from "react-bootstrap/Table";
import Spinner from "react-bootstrap/Spinner";
import Container from "react-bootstrap/Container";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";

import "@fortawesome/fontawesome-free/css/all.min.css";
import "bootstrap-css-only/css/bootstrap.min.css";
import "mdbreact/dist/css/mdb.css";

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
      <div className="d-flex justify-content-center">
        <Spinner className="spinner-border m-5" animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </div>
    );
  }

  return (
    <Container fluid="md" style={{ paddingTop: 25 }}>
      <h3 className="mb-4">Account Settings</h3>
      
      <Table responsive>
        <tbody>
          <tr>
            <td colSpan="2">
              <h5 className="mb-3">Profile picture</h5>
            </td>
          </tr>
          <tr>
            <td style={{ width: "200px" }}>
              <Image
                src={`https://www.gravatar.com/avatar/${username}`}
                alt={`Avatar for ${username} from gravatar.com`}
                title={`Avatar for ${username} from gravatar.com`}
              />
              <br />
              <br />
              <a href={`/users/${username}`} style={{ textDecoration: "none" }}>
                @{username}
              </a>
            </td>
            <td>
              We use <a href="https://gravatar.com">gravatar.com</a> to generate
              your profile picture based on your primary email address —
              <code className="break"> {email} </code>.<br />
              <br />
              <div className="d-flex gap-2">
                <Button variant="outline-primary" onClick={handleOpenPasswordModal}>
                  Change Password
                </Button>
                <Button variant="outline-secondary" onClick={handleOpenEmailModal}>
                  Change Email
                </Button>
              </div>
            </td>
          </tr>
          <tr>
            <td colSpan="2">
              <h5 className="mb-3 mt-3">Account details</h5>
            </td>
          </tr>
          <tr>
            <td>
              <h6>Username</h6>
            </td>
            <td>@{username}</td>
          </tr>
          <tr>
            <td>
              <h6>Date Joined</h6>
            </td>
            <td>{dateJoined}</td>
          </tr>
          <tr>
            <td>
              <h6>Primary Email</h6>
            </td>
            <td>{email}</td>
          </tr>
        </tbody>
      </Table>

      {/* Password Reset Modal */}
      <Modal show={showPasswordModal} onHide={handleClosePasswordModal}>
        <Modal.Header closeButton>
          <Modal.Title>Change Password</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handlePasswordSubmit}>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm="4">
                Current Password
              </Form.Label>
              <Col sm="8">
                <Form.Control
                  type="password"
                  placeholder="Enter current password"
                  name="oldPassword"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  isInvalid={!!formErrors.oldPassword}
                />
                <Form.Control.Feedback type="invalid">
                  {formErrors.oldPassword}
                </Form.Control.Feedback>
              </Col>
            </Form.Group>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm="4">
                New Password
              </Form.Label>
              <Col sm="8">
                <Form.Control
                  type="password"
                  placeholder="Enter new password"
                  name="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  isInvalid={!!formErrors.newPassword}
                />
                <Form.Control.Feedback type="invalid">
                  {formErrors.newPassword}
                </Form.Control.Feedback>
              </Col>
            </Form.Group>

            {error && (
              <Alert variant="danger" className="mt-3">
                {error}
              </Alert>
            )}
            {message && (
              <Alert variant="success" className="mt-3">
                {message}
              </Alert>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClosePasswordModal}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handlePasswordSubmit}
            disabled={isLoadingPassword}
          >
            {isLoadingPassword ? (
              <>
                <Spinner size="sm" animation="border" className="me-2" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Change Email Modal */}
      <Modal show={showEmailModal} onHide={handleCloseEmailModal}>
        <Modal.Header closeButton>
          <Modal.Title>Change Email</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleEmailSubmit}>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm="4">
                New Email
              </Form.Label>
              <Col sm="8">
                <Form.Control
                  type="email"
                  placeholder="Enter new email address"
                  name="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  isInvalid={!!formErrors.email}
                />
                <Form.Control.Feedback type="invalid">
                  {formErrors.email}
                </Form.Control.Feedback>
              </Col>
            </Form.Group>

            {error && (
              <Alert variant="danger" className="mt-3">
                {error}
              </Alert>
            )}
            {message && (
              <Alert variant="success" className="mt-3">
                {message}
              </Alert>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseEmailModal}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleEmailSubmit}
            disabled={isLoadingEmail}
          >
            {isLoadingEmail ? (
              <>
                <Spinner size="sm" animation="border" className="me-2" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Account;
