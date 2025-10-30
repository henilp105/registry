import { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";
import {
  addNamespaceAdmin,
  resetMessages,
} from "../store/actions/namespaceAdminsActions";

const AddNamespaceAdminFormDialog = ({ namespace, show, onHide }) => {
  const [username, setUsername] = useState("");
  const [validationError, setValidationError] = useState("");
  const [touched, setTouched] = useState(false);
  
  const dispatch = useDispatch();
  
  const currUsername = useSelector((state) => state.auth.username);
  const uuid = useSelector((state) => state.auth.uuid);
  const { successMessage, errorMessage, isLoading } = useSelector(
    (state) => state.addRemoveNamespaceAdmin
  );

  const validateUsername = useCallback((value) => {
    if (!value.trim()) return "Username is required";
    if (value.length < 2) return "Username must be at least 2 characters";
    return null;
  }, []);

  const validateForm = useCallback(() => {
    const error = validateUsername(username);
    setValidationError(error);
    return !error;
  }, [username, validateUsername]);

  const handleBlur = useCallback(() => {
    setTouched(true);
    setValidationError(validateUsername(username));
  }, [username, validateUsername]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    setTouched(true);
    dispatch(resetMessages());

    if (!validateForm()) return;

    dispatch(
      addNamespaceAdmin(
        {
          uuid,
          namespace,
          username_to_be_added: username,
        },
        currUsername
      )
    );
  }, [dispatch, uuid, namespace, username, currUsername, validateForm]);

  const resetData = useCallback(() => {
    setUsername("");
    setValidationError("");
    setTouched(false);
    dispatch(resetMessages());
  }, [dispatch]);

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="md"
      aria-labelledby="add-namespace-admin-modal"
      centered
      onExited={resetData}
    >
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title id="add-namespace-admin-modal">
            Add Namespace Admin
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">
            Add an admin to namespace <strong>{namespace}</strong>
          </p>

          <Form.Group className="mb-3">
            <Form.Label>Username</Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter username to add"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={handleBlur}
              isInvalid={touched && !!validationError}
              disabled={isLoading}
            />
            <Form.Control.Feedback type="invalid">
              {validationError}
            </Form.Control.Feedback>
          </Form.Group>

          {successMessage && (
            <Alert variant="success" className="mb-0">
              <i className="fas fa-check-circle me-2" />
              {successMessage}
            </Alert>
          )}
          {errorMessage && (
            <Alert variant="danger" className="mb-0">
              <i className="fas fa-exclamation-circle me-2" />
              {errorMessage}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="success" type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Adding...
              </>
            ) : (
              <>
                <i className="fas fa-user-plus me-2" />
                Add Admin
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default AddNamespaceAdminFormDialog;
