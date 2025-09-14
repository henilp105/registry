import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchPackages } from "../store/actions/dashboardActions";
import { useNavigate } from "react-router-dom";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Container from "react-bootstrap/Container";
import { Link } from "react-router-dom";
import { SkeletonDashboardCard } from "../components/SkeletonLoader";
import AddMaintainerFormDialog from "./addMaintainerDialogForm";
import RemoveMaintainerFormDialog from "./removeMaintainerDialogForm";
import GenerateNamespaceTokenDialogForm from "./generateNamespaceTokenDialogForm";
import AddNamespaceMaintainerFormDialog from "./addNamespaceMaintainerDialogForm";
import RemoveNamespaceMaintainerFormDialog from "./removeNamespaceMaintainerDialogForm";
import AddNamespaceAdminFormDialog from "./addNamespaceAdminForm";
import RemoveNamespaceAdminFormDialog from "./removeNamespaceAdminForm";
import GeneratePackageTokenDialogForm from "./generatePackageTokenDialogForm";

const Dashboard = () => {
  const [addMaintainerDialogState, setAddMaintainerDialogState] = useState({});
  const [showGenerateTokenDialog, setshowGenerateTokenDialog] = useState({});
  const [removeMaintainerDialogState, setRemoveMaintainerDialogState] =
    useState({});
  const [addNamespaceAdminDialogState, setAddNamespaceAdminDialogState] =
    useState({});
  const [removeNamespaceAdminDialogState, setRemoveNamespaceAdminDialogState] =
    useState({});
  const username = useSelector((state) => state.auth.username);
  const packages = useSelector((state) => state.dashboard.packages);
  const namespaces = useSelector((state) => state.dashboard.namespaces);
  const isLoading = useSelector((state) => state.dashboard.isLoading || state.auth.isLoading);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    if (username === null) {
      navigate("/");
      return;
    }
    
    if (!packages) {
      dispatch(fetchPackages(username));
    }
  }, [packages, username, dispatch, navigate]);

  const handleAddMaintainerDialog = useCallback((itemId, value) => {
    setAddMaintainerDialogState((prevState) => ({
      ...prevState,
      [itemId]: value,
    }));
  }, []);

  const handleRemoveMaintainerDialog = useCallback((itemId, value) => {
    setRemoveMaintainerDialogState((prevState) => ({
      ...prevState,
      [itemId]: value,
    }));
  }, []);

  const handleGenerateTokenDialog = useCallback((itemId, value) => {
    setshowGenerateTokenDialog((prevState) => ({
      ...prevState,
      [itemId]: value,
    }));
  }, []);

  const handleAddNamespaceAdminDialog = useCallback((itemId, value) => {
    setAddNamespaceAdminDialogState((prevState) => ({
      ...prevState,
      [itemId]: value,
    }));
  }, []);

  const handleRemoveNamespaceAdminDialog = useCallback((itemId, value) => {
    setRemoveNamespaceAdminDialogState((prevState) => ({
      ...prevState,
      [itemId]: value,
    }));
  }, []);

  // Skeleton loader for loading state
  const DashboardSkeleton = useMemo(() => (
    <Container style={{ paddingTop: 25 }}>
      <h5 className="mb-3 text-muted">Loading your dashboard...</h5>
      <p className="text-start mb-2" style={{ fontSize: 18 }}>Namespaces</p>
      <Row>
        {[1, 2, 3].map((i) => (
          <Col key={i} xs={12} md={4}>
            <SkeletonDashboardCard />
          </Col>
        ))}
      </Row>
      <p className="text-start mb-2 mt-4" style={{ fontSize: 18 }}>Packages</p>
      <Row>
        {[1, 2, 3].map((i) => (
          <Col key={i} xs={12} md={4}>
            <SkeletonDashboardCard />
          </Col>
        ))}
      </Row>
    </Container>
  ), []);

  if (isLoading) {
    return DashboardSkeleton;
  }

  return (
    <Container style={{ paddingTop: 25 }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Welcome back, {username}!</h4>
      </div>
      
      <section className="mb-4">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0">Namespaces</h5>
          <Link to="/namespace/create" className="btn btn-sm btn-outline-primary">
            <i className="fas fa-plus me-1" /> Create Namespace
          </Link>
        </div>
        {Namespaces()}
      </section>
      
      <section>
        <h5 className="mb-2">Packages</h5>
        {Packages()}
      </section>
    </Container>
  );

  function Packages() {
    return packages.length === 0 ? (
      <div className="alert alert-secondary" role="alert">
        You are not a maintainer of any package yet.
      </div>
    ) : (
      <Row>
        {packages.map((element, index) => (
          <Col key={element.id} xs={12} md={4}>
            <Card id="dashboard-card">
              <Card.Body>
                <Card.Title>
                  <div className="d-flex justify-content-between">
                    <a
                      href={`/packages/${element.namespace}/${element.name}`}
                      className="dashboard-title"
                    >
                      {element.name}
                    </a>
                    {element.isNamespaceAdmin ? (
                      <label className="chip">Namespace Admin</label>
                    ) : element.isNamespaceMaintainer ? (
                      <label className="chip">Namespace Maintainer</label>
                    ) : element.isPackageMaintainer ? (
                      <label className="chip">Package Maintainer</label>
                    ) : null}
                  </div>
                </Card.Title>
                <Card.Subtitle className="mb-2 text-muted">
                  {element.namespace}
                </Card.Subtitle>
                <Card.Text id="card-text">{element.description}</Card.Text>
                <div className="chip-container">
                  <div
                    className="border border-success rounded-pill chip-action"
                    onClick={() => handleAddMaintainerDialog(element.id, true)}
                  >
                    Add Maintainers
                  </div>
                  {element.isNamespaceMaintainer || element.isNamespaceAdmin ? (
                    <div
                      className="border border-danger rounded-pill chip-action"
                      onClick={() =>
                        handleRemoveMaintainerDialog(element.id, true)
                      }
                    >
                      Remove Maintainers
                    </div>
                  ) : null}
                </div>
                {element.isPackageMaintainer &&
                !element.isNamespaceAdmin &&
                !element.isNamespaceMaintainer ? (
                  <div
                    className="border border-success rounded-pill chip-action"
                    onClick={() => handleGenerateTokenDialog(element.id, true)}
                  >
                    Generate Token
                  </div>
                ) : null}

                <AddMaintainerFormDialog
                  package={element.name}
                  namespace={element.namespace}
                  show={addMaintainerDialogState[element.id]}
                  onHide={() => handleAddMaintainerDialog(element.id, false)}
                />
                <RemoveMaintainerFormDialog
                  package={element.name}
                  namespace={element.namespace}
                  show={removeMaintainerDialogState[element.id]}
                  onHide={() => handleRemoveMaintainerDialog(element.id, false)}
                />
                <GeneratePackageTokenDialogForm
                  namespace={element.namespace}
                  package={element.name}
                  show={showGenerateTokenDialog[element.id]}
                  onHide={() => handleGenerateTokenDialog(element.id, false)}
                />
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    );
  }

  function Namespaces() {
    if (!namespaces || namespaces.length === 0) {
      return (
        <div className="alert alert-light border text-center py-4" role="alert">
          <i className="fas fa-folder-open fa-2x text-muted mb-2" />
          <p className="mb-2">You haven't created any namespaces yet.</p>
          <Link to="/namespace/create" className="btn btn-primary btn-sm">
            Create your first namespace
          </Link>
        </div>
      );
    }

    return (
      <Row>
        {namespaces.map((element) => (
          <Col key={element.name} xs={12} md={4} className="mb-3">
            <Card id="dashboard-card" className="h-100">
              <Card.Body className="d-flex flex-column">
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <Card.Title className="mb-0">
                    <Link
                      to={`/namespaces/${element.name}`}
                      className="dashboard-title fw-semibold"
                    >
                      <i className="fas fa-folder me-2 text-primary" />
                      {element.name}
                    </Link>
                  </Card.Title>
                  {element.isNamespaceAdmin ? (
                    <span className="chip bg-primary text-white">Admin</span>
                  ) : element.isNamespaceMaintainer ? (
                    <span className="chip">Maintainer</span>
                  ) : null}
                </div>
                <Card.Text id="card-text" className="text-muted small flex-grow-1">
                  {element.description || "No description"}
                </Card.Text>
                <div className="chip-container mt-auto pt-2">
                  <button
                    className="border border-success rounded-pill chip-action text-success"
                    onClick={() => handleGenerateTokenDialog(element.id, true)}
                    type="button"
                  >
                    <i className="fas fa-key me-1" /> Token
                  </button>
                  {element.isNamespaceAdmin && (
                    <>
                      <button
                        className="border border-success rounded-pill chip-action text-success"
                        onClick={() => handleAddNamespaceAdminDialog(element.id, true)}
                        type="button"
                      >
                        <i className="fas fa-user-plus me-1" /> Admin
                      </button>
                      <button
                        className="border border-danger rounded-pill chip-action text-danger"
                        onClick={() => handleRemoveNamespaceAdminDialog(element.id, true)}
                        type="button"
                      >
                        <i className="fas fa-user-minus me-1" /> Admin
                      </button>
                    </>
                  )}
                  <button
                    className="border border-success rounded-pill chip-action text-success"
                    onClick={() => handleAddMaintainerDialog(element.id, true)}
                    type="button"
                  >
                    <i className="fas fa-user-plus me-1" /> Maintainer
                  </button>
                  {element.isNamespaceAdmin && (
                    <button
                      className="border border-danger rounded-pill chip-action text-danger"
                      onClick={() => handleRemoveMaintainerDialog(element.id, true)}
                      type="button"
                    >
                      <i className="fas fa-user-minus me-1" /> Maintainer
                    </button>
                  )}
                </div>
                
                {/* Dialogs */}
                <GenerateNamespaceTokenDialogForm
                  namespace={element.name}
                  show={showGenerateTokenDialog[element.id]}
                  onHide={() => handleGenerateTokenDialog(element.id, false)}
                />
                <AddNamespaceAdminFormDialog
                  namespace={element.name}
                  show={addNamespaceAdminDialogState[element.id]}
                  onHide={() => handleAddNamespaceAdminDialog(element.id, false)}
                />
                <RemoveNamespaceAdminFormDialog
                  namespace={element.name}
                  show={removeNamespaceAdminDialogState[element.id]}
                  onHide={() => handleRemoveNamespaceAdminDialog(element.id, false)}
                />
                <AddNamespaceMaintainerFormDialog
                  namespace={element.name}
                  show={addMaintainerDialogState[element.id]}
                  onHide={() => handleAddMaintainerDialog(element.id, false)}
                />
                <RemoveNamespaceMaintainerFormDialog
                  namespace={element.name}
                  show={removeMaintainerDialogState[element.id]}
                  onHide={() => handleRemoveMaintainerDialog(element.id, false)}
                />
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    );
  }
};

export default Dashboard;
