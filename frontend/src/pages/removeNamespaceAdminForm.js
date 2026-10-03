import { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";
import {
  removeNamespaceAdmin,
  resetMessages,
} from "../store/actions/namespaceAdminsActions";
import Icon from "../components/Icon";

const RemoveNamespaceAdminFormDialog = ({ namespace, show, onHide }) => {
  const [username, setUsername] = useState("");
  const [validationError, setValidationError] = useState("");
  const [touched, setTouched] = useState(false);
  
  const dispatch = useDispatch();
  
  const currUsername = useSelector((state) => state.auth.username);
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
      removeNamespaceAdmin(
        {
            namespace,
          username_to_be_removed: username,
        },
        currUsername
      )
    );
  }, [dispatch, namespace, username, currUsername, validateForm]);

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
      aria-labelledby="remove-namespace-admin-modal"
      centered
      onExited={resetData}
    >
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title id="remove-namespace-admin-modal">
            Remove Namespace Admin
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">
            Remove an admin from namespace <strong>{namespace}</strong>
          </p>

          <Form.Group className="mb-3" controlId="removenamespaceadmin-username">
            {/* Defect D104: `controlId` is what ties the <label> to the control.
              Without it react-bootstrap renders a bare <label> with no
              `for` and the control has no `id`, so the field has no
              accessible name -- announced only as "edit text" -- and
              clicking the visible label does not focus it. Every other
              form in the app (account.js, resetpassword.js, login.js)
              passes it; these were the ones missed. Plain HTML ids, so
              the association is assertable in CI: see
              scripts/check_form_labels.mjs. */}
            <Form.Label>Username</Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter username to remove"
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
              <Icon name="check-circle" className="me-2" />
              {successMessage}
            </Alert>
          )}
          {errorMessage && (
            <Alert variant="danger" className="mb-0">
              <Icon name="exclamation-circle" className="me-2" />
              {errorMessage}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Removing...
              </>
            ) : (
              <>
                <Icon name="user-minus" className="me-2" />
                Remove Admin
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default RemoveNamespaceAdminFormDialog;
