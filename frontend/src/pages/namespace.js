import React, { useState, useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchNamespaceData } from "../store/actions/namespaceActions";
import { 
  Box, 
  CalendarEvent, 
  ChevronRight,
  ShieldCheck,
  People,
  BoxSeam
} from "react-bootstrap-icons";
import { useNavigate, useParams } from "react-router-dom";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Spinner from "react-bootstrap/Spinner";
import PackageItem from "../components/packageItem";
import ShowUserListDialog from "./showUserListDialog";
import "./namespace.css";

const NamespacePage = () => {
  const { namespace } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  const { dateJoined, description, projects, notFound, isLoading, error } = useSelector(
    (state) => state.namespace
  );

  const [isListDialogOpen, setListDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState(null);

  useEffect(() => {
    dispatch(fetchNamespaceData(namespace));
  }, [dispatch, namespace]);

  useEffect(() => {
    if (notFound) {
      navigate("/404");
    }
  }, [notFound, navigate]);

  const openDialog = useCallback((type) => {
    setDialogType(type);
    setListDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setListDialogOpen(false);
    setDialogType(null);
  }, []);

  const formatDate = (dateString) => {
    if (!dateString) return "Unknown";
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(date);
    } catch {
      // Surface the raw value rather than a bogus fixed-offset slice that
      // silently masks malformed API data.
      return String(dateString);
    }
  };

  if (isLoading) {
    return (
      <Container className="namespace-loading-state">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
        <p className="namespace-loading-text">Loading namespace...</p>
      </Container>
    );
  }

  // Defect D85: a failed fetch used to claim the namespace was a 404. Any
  // other failure now surfaces here instead.
  if (error) {
    return (
      <Container className="namespace-container">
        <div className="alert alert-danger" role="alert">
          Could not load this namespace: {error}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => dispatch(fetchNamespaceData(namespace))}>
          Try again
        </button>
      </Container>
    );
  }

  return (
    <Container className="namespace-container">
      <Row className="g-4">
        {/* Sidebar */}
        <Col lg={3} md={4}>
          <div className="namespace-sidebar">
            <div className="namespace-card">
              <img
                className="namespace-avatar"
                alt={`Avatar for ${namespace}`}
                src={`https://www.gravatar.com/avatar/${namespace}?d=identicon&s=200`}
              />
              
              <h1 className="namespace-title">{namespace}</h1>

              {/* Defect D67. The create form asks for a description, the API stored
                  it, and nothing ever showed it -- so the field was write-only and
                  a namespace owner who wrote a real description saw nothing at all
                  when they came back. Rendered only when non-empty, so the
                  namespaces created before this existed (and those left blank)
                  look exactly as they did. */}
              {description ? (
                <p className="namespace-description">{description}</p>
              ) : null}
              
              <ul className="namespace-info-list">
                <li className="namespace-info-item">
                  <Box className="namespace-info-icon" />
                  <span className="namespace-info-label">Namespace</span>
                </li>
                
                <li className="namespace-info-item">
                  <CalendarEvent className="namespace-info-icon" />
                  <span className="namespace-info-value">{formatDate(dateJoined)}</span>
                </li>
                
                <li 
                  className="namespace-info-item namespace-info-clickable"
                  onClick={() => openDialog('admins')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                      // role="button" must respond to Space as well as Enter.
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDialog('admins'); }
                    }}
                >
                  <ShieldCheck className="namespace-info-icon" />
                  <span>Admins</span>
                  <ChevronRight className="chevron-icon" size={16} />
                </li>
                
                <li 
                  className="namespace-info-item namespace-info-clickable"
                  onClick={() => openDialog('maintainers')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDialog('maintainers'); }
                    }}
                >
                  <People className="namespace-info-icon" />
                  <span>Maintainers</span>
                  <ChevronRight className="chevron-icon" size={16} />
                </li>
              </ul>
            </div>
          </div>
          
          {dialogType && (
            <ShowUserListDialog
              maintainers={dialogType === 'maintainers'}
              admins={dialogType === 'admins'}
              onHide={closeDialog}
              namespace={namespace}
              show={isListDialogOpen}
            />
          )}
        </Col>

        {/* Packages Section */}
        <Col lg={9} md={8}>
          <div className="packages-section">
            <div className="packages-header">
              <h2 className="packages-title">Packages</h2>
              <span className="packages-count">
                {projects.length} {projects.length === 1 ? 'Package' : 'Packages'}
              </span>
            </div>

            {projects.length === 0 ? (
              <div className="no-packages-message">
                <BoxSeam className="no-packages-icon" size={56} />
                <p>No packages in this namespace yet.</p>
              </div>
            ) : (
              <div className="packages-list">
                {projects.map((packageEntity) => (
                  <PackageItem 
                    key={`${packageEntity.namespace}-${packageEntity.name}`} 
                    packageEntity={packageEntity} 
                  />
                ))}
              </div>
            )}
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export default NamespacePage;
