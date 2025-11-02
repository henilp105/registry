import React, { useEffect, useState, useCallback } from "react";
import { Container, Row, Col, Card, Form, Button, Alert, Modal } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { MDBIcon } from "mdb-react-ui-kit";
import {
  adminAuth,
  deleteUser,
  deleteNamespace,
  deletePackage,
  deleteRelease,
  deprecatePackage,
  resetAdminMessages,
} from "../store/actions/adminActions";
import ViewMalicousReports from "./viewMalicousReports";
import NoPage from "./404";

const AdminSection = () => {
  const dispatch = useDispatch();
  
  const uuid = useSelector((state) => state.auth.uuid);
  const accessToken = useSelector((state) => state.auth.accessToken);
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  const { message, statuscode, isAdmin, isLoading } = useSelector((state) => state.admin);

  const [showReports, setShowReports] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertVariant, setAlertVariant] = useState("info");

  const handleShowReports = useCallback((value) => {
    setShowReports(value);
  }, []);

  useEffect(() => {
    if (accessToken) {
      dispatch(adminAuth(accessToken));
    }
  }, [isAuthenticated, accessToken, dispatch]);

  useEffect(() => {
    if (statuscode != null && message) {
      setAlertVariant(statuscode >= 200 && statuscode < 300 ? "success" : "danger");
      setAlertMessage(`${statuscode}: ${message}`);
      // Auto-clear alert after 5 seconds
      const timer = setTimeout(() => {
        setAlertMessage(null);
        dispatch(resetAdminMessages());
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [statuscode, message, dispatch]);

  const [formData, setFormData] = useState({
    namespaceName: "",
    packageName: "",
    releaseName: "",
    userName: "",
    newPassword: "",
  });

  const [modalData, setModalData] = useState({
    showModal: false,
    modalTitle: "",
    modalMessage: "",
    modalAction: null,
  });

  const handleInputChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  }, []);

  const openModal = useCallback((title, message, action) => {
    setModalData({
      showModal: true,
      modalTitle: title,
      modalMessage: message,
      modalAction: action,
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalData(prev => ({ ...prev, showModal: false, modalAction: null }));
  }, []);

  const validateFields = useCallback((...values) => {
    if (values.some((value) => !value || value === "")) {
      openModal("Empty Fields", "Please fill out all fields.", null);
      return false;
    }
    return true;
  }, [openModal]);

  const handleAction = useCallback(() => {
    if (modalData.modalAction) {
      modalData.modalAction();
    }
    closeModal();
  }, [modalData.modalAction, closeModal]);

  const handleDeletePackage = useCallback(() => {
    if (!validateFields(formData.namespaceName, formData.packageName)) return;
    
    openModal(
      "Delete Package",
      `You will not be able to recover ${formData.namespaceName}/${formData.packageName} package after you delete it.`,
      () => {
        dispatch(deletePackage(formData.namespaceName, formData.packageName, uuid));
        setFormData(prev => ({ ...prev, namespaceName: "", packageName: "" }));
      }
    );
  }, [formData.namespaceName, formData.packageName, uuid, dispatch, openModal, validateFields]);

  const handleDeleteRelease = useCallback(() => {
    if (!validateFields(formData.namespaceName, formData.packageName, formData.releaseName)) return;
    
    openModal(
      "Delete Release",
      `You will not be able to recover ${formData.namespaceName}/${formData.packageName}/${formData.releaseName} release after you delete it.`,
      () => {
        dispatch(deleteRelease(formData.namespaceName, formData.packageName, formData.releaseName, uuid));
        setFormData(prev => ({ ...prev, namespaceName: "", packageName: "", releaseName: "" }));
      }
    );
  }, [formData.namespaceName, formData.packageName, formData.releaseName, uuid, dispatch, openModal, validateFields]);

  const handleDeleteUser = useCallback(() => {
    if (!validateFields(formData.userName)) return;
    
    openModal(
      "Delete User",
      `You will not be able to recover ${formData.userName} user after you delete it.`,
      () => {
        dispatch(deleteUser(formData.userName, uuid));
        setFormData(prev => ({ ...prev, userName: "" }));
      }
    );
  }, [formData.userName, uuid, dispatch, openModal, validateFields]);

  const handleDeleteNamespace = useCallback(() => {
    if (!validateFields(formData.namespaceName)) return;
    
    openModal(
      "Delete Namespace",
      `You will not be able to recover ${formData.namespaceName} namespace after you delete it.`,
      () => {
        dispatch(deleteNamespace(formData.namespaceName, uuid));
        setFormData(prev => ({ ...prev, namespaceName: "" }));
      }
    );
  }, [formData.namespaceName, uuid, dispatch, openModal, validateFields]);

  const handleDeprecatePackage = useCallback(() => {
    if (!validateFields(formData.namespaceName, formData.packageName)) return;
    
    openModal(
      "Deprecate Package",
      `Are you sure you want to deprecate ${formData.namespaceName}/${formData.packageName}?`,
      () => {
        dispatch(deprecatePackage(formData.namespaceName, formData.packageName, uuid));
        setFormData(prev => ({ ...prev, namespaceName: "", packageName: "" }));
      }
    );
  }, [formData.namespaceName, formData.packageName, uuid, dispatch, openModal, validateFields]);

  //   const changePassword = () => {   // TODO: Enable this feature
  //     console.log("Changing password for user:", formData.userName);
  //     // Add the logic to change the password
  //     // clear the form data
  //     setFormData({
  //       userName: "",
  //       newPassword: "",
  //     });
  //   };

  return isAdmin ? (
    <Container className="py-4">
      <h2 className="mb-4">Admin Settings</h2>
      
      {alertMessage && (
        <Alert 
          variant={alertVariant} 
          dismissible 
          onClose={() => setAlertMessage(null)}
          className="mb-4"
        >
          {alertMessage}
        </Alert>
      )}

      <Card className="mb-4">
        <Card.Header>
          <h5 className="mb-0">
            <MDBIcon fas icon="flag" className="me-2" />
            Malicious Reports
          </h5>
        </Card.Header>
        <Card.Body>
          <p className="text-muted mb-3">View and manage user-submitted malicious package reports.</p>
          <Button onClick={() => handleShowReports(true)}>
            <MDBIcon fas icon="eye" className="me-2" />
            View Reports
          </Button>
        </Card.Body>
      </Card>

      <Row>
        <Col md={6} className="mb-4">
          <Card className="h-100">
            <Card.Header className="bg-danger text-white">
              <h5 className="mb-0">
                <MDBIcon fas icon="trash-alt" className="me-2" />
                Delete Package
              </h5>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label>Namespace Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter namespace name"
                  name="namespaceName"
                  value={formData.namespaceName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Package Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter package name"
                  name="packageName"
                  value={formData.packageName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Button variant="danger" onClick={handleDeletePackage} disabled={isLoading}>
                Delete Package
              </Button>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} className="mb-4">
          <Card className="h-100">
            <Card.Header className="bg-danger text-white">
              <h5 className="mb-0">
                <MDBIcon fas icon="tag" className="me-2" />
                Delete Release
              </h5>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label>Namespace Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter namespace name"
                  name="namespaceName"
                  value={formData.namespaceName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Package Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter package name"
                  name="packageName"
                  value={formData.packageName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Release Version</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter release version"
                  name="releaseName"
                  value={formData.releaseName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Button variant="danger" onClick={handleDeleteRelease} disabled={isLoading}>
                Delete Release
              </Button>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} className="mb-4">
          <Card className="h-100">
            <Card.Header className="bg-warning">
              <h5 className="mb-0">
                <MDBIcon fas icon="archive" className="me-2" />
                Deprecate Package
              </h5>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label>Namespace Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter namespace name"
                  name="namespaceName"
                  value={formData.namespaceName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Package Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter package name"
                  name="packageName"
                  value={formData.packageName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Button variant="warning" onClick={handleDeprecatePackage} disabled={isLoading}>
                Deprecate Package
              </Button>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} className="mb-4">
          <Card className="h-100">
            <Card.Header className="bg-danger text-white">
              <h5 className="mb-0">
                <MDBIcon fas icon="folder-minus" className="me-2" />
                Delete Namespace
              </h5>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label>Namespace Name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter namespace name"
                  name="namespaceName"
                  value={formData.namespaceName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Button variant="danger" onClick={handleDeleteNamespace} disabled={isLoading}>
                Delete Namespace
              </Button>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6} className="mb-4">
          <Card className="h-100">
            <Card.Header className="bg-danger text-white">
              <h5 className="mb-0">
                <MDBIcon fas icon="user-minus" className="me-2" />
                Delete User
              </h5>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label>Username</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Enter username"
                  name="userName"
                  value={formData.userName}
                  onChange={handleInputChange}
                />
              </Form.Group>
              <Button variant="danger" onClick={handleDeleteUser} disabled={isLoading}>
                Delete User
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <ViewMalicousReports
        show={showReports}
        onHide={() => handleShowReports(false)}
      />

      <Modal show={modalData.showModal} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>{modalData.modalTitle}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex align-items-center">
            <MDBIcon fas icon="exclamation-triangle" className="text-warning me-3" size="2x" />
            <span>{modalData.modalMessage}</span>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          {modalData.modalAction && (
            <Button variant="danger" onClick={handleAction}>
              Confirm
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    </Container>
  ) : (
    <NoPage />
  );
};

export default AdminSection;
