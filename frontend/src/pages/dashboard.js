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
import Icon from "../components/Icon";
import "./dashboard.css";

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
  const DashboardSkeleton = useMemo(
    () => (
      <Container className="dashboard">
        <p className="text-muted mb-3" role="status">
          Loading your dashboard&hellip;
        </p>
        <p className="dashboard__section-title mb-2">Namespaces</p>
        <Row>
          {[1, 2, 3].map((i) => (
            <Col key={i} xs={12} md={4}>
              <SkeletonDashboardCard />
            </Col>
          ))}
        </Row>
        <p className="dashboard__section-title mb-2 mt-4">Packages</p>
        <Row>
          {[1, 2, 3].map((i) => (
            <Col key={i} xs={12} md={4}>
              <SkeletonDashboardCard />
            </Col>
          ))}
        </Row>
      </Container>
    ),
    []
  );

  if (isLoading) {
    return DashboardSkeleton;
  }

  return (
    <Container className="dashboard">
      <h1 className="dashboard__greeting">Welcome back, {username}!</h1>

      <section className="dashboard__section" aria-labelledby="dashboard-namespaces">
        <div className="dashboard__section-header">
          <h2 className="dashboard__section-title" id="dashboard-namespaces">
            Namespaces
          </h2>
          <Link to="/namespace/create" className="btn btn-sm btn-outline-primary">
            <Icon name="plus" className="me-1" size={13} /> Create Namespace
          </Link>
        </div>
        {Namespaces()}
      </section>

      <section className="dashboard__section" aria-labelledby="dashboard-packages">
        <h2 className="dashboard__section-title mb-3" id="dashboard-packages">
          Packages
        </h2>
        {Packages()}
      </section>
    </Container>
  );

  function Packages() {
    if (!packages || packages.length === 0) {
      return (
        <div className="alert alert-secondary" role="alert">
          You are not a maintainer of any package yet.
        </div>
      );
    }

    return (
      <Row>
        {packages.map((element, index) => (
          <Col key={element.id} xs={12} md={4}>
            <Card id="dashboard-card">
              <Card.Body>
                <Card.Title>
                  <div className="d-flex justify-content-between">
                    {/* A router Link, not an <a href>: this is an in-app
                        route, and a plain anchor reloads the whole SPA. */}
                    <Link
                      to={`/packages/${element.namespace}/${element.name}`}
                      className="dashboard-title"
                    >
                      {element.name}
                    </Link>
                    {element.isNamespaceAdmin ? (
                      <span className="chip dashboard__role">Namespace Admin</span>
                    ) : element.isNamespaceMaintainer ? (
                      <span className="chip dashboard__role">
                        Namespace Maintainer
                      </span>
                    ) : element.isPackageMaintainer ? (
                      <span className="chip dashboard__role">
                        Package Maintainer
                      </span>
                    ) : null}
                  </div>
                </Card.Title>
                <Card.Subtitle className="mb-2 text-muted">
                  {element.namespace}
                </Card.Subtitle>
                <Card.Text id="card-text">{element.description}</Card.Text>
                {/*
                  These were <div onClick>, which are not focusable and have
                  no keyboard activation at all - the package card's three
                  primary actions were unreachable without a mouse. Real
                  <button>s now; the visual is unchanged because .chip-action
                  already carried the pill styling.
                */}
                <div className="chip-container">
                  <button
                    type="button"
                    className="border border-success rounded-pill chip-action text-success"
                    onClick={() => handleAddMaintainerDialog(element.id, true)}
                  >
                    Add Maintainers
                  </button>
                  {element.isNamespaceMaintainer || element.isNamespaceAdmin ? (
                    <button
                      type="button"
                      className="border border-danger rounded-pill chip-action text-danger"
                      onClick={() =>
                        handleRemoveMaintainerDialog(element.id, true)
                      }
                    >
                      Remove Maintainers
                    </button>
                  ) : null}
                </div>
                {element.isPackageMaintainer &&
                !element.isNamespaceAdmin &&
                !element.isNamespaceMaintainer ? (
                  <button
                    type="button"
                    className="border border-success rounded-pill chip-action text-success mt-2"
                    onClick={() => handleGenerateTokenDialog(element.id, true)}
                  >
                    Generate Token
                  </button>
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
        <div className="alert alert-light border dashboard__empty">
          <Icon name="folder-open" size={32} className="dashboard__empty-icon" />
          <p className="mb-2">You haven&rsquo;t created any namespaces yet.</p>
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
                      <Icon name="folder" className="me-2 text-primary" size={16} />
                      {element.name}
                    </Link>
                  </Card.Title>
                  {element.isNamespaceAdmin ? (
                    <span className="chip dashboard__role">Admin</span>
                  ) : element.isNamespaceMaintainer ? (
                    <span className="chip dashboard__role">Maintainer</span>
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
                    title="Generate an upload token for this namespace"
                  >
                    <Icon name="key" className="me-1" /> Generate Token
                  </button>
                  {element.isNamespaceAdmin && (
                    <>
                      <button
                        className="border border-success rounded-pill chip-action text-success"
                        onClick={() => handleAddNamespaceAdminDialog(element.id, true)}
                        type="button"
                        title="Add a new admin to this namespace"
                      >
                        <Icon name="user-plus" className="me-1" /> Add Admin
                      </button>
                      <button
                        className="border border-danger rounded-pill chip-action text-danger"
                        onClick={() => handleRemoveNamespaceAdminDialog(element.id, true)}
                        type="button"
                        title="Remove an admin from this namespace"
                      >
                        <Icon name="user-minus" className="me-1" /> Remove Admin
                      </button>
                    </>
                  )}
                  <button
                    className="border border-success rounded-pill chip-action text-success"
                    onClick={() => handleAddMaintainerDialog(element.id, true)}
                    type="button"
                    title="Add a new maintainer to this namespace"
                  >
                    <Icon name="user-plus" className="me-1" /> Add Maintainer
                  </button>
                  {element.isNamespaceAdmin && (
                    <button
                      className="border border-danger rounded-pill chip-action text-danger"
                      onClick={() => handleRemoveMaintainerDialog(element.id, true)}
                      type="button"
                      title="Remove a maintainer from this namespace"
                    >
                      <Icon name="user-minus" className="me-1" /> Remove Maintainer
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
