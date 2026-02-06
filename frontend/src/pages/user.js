import React, { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchUserData } from "../store/actions/userActions";
import { PersonCircle, CalendarEvent, Envelope, Archive } from "react-bootstrap-icons";
import { useNavigate, useParams } from "react-router-dom";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Spinner from "react-bootstrap/Spinner";
import PackageItem from "../components/packageItem";
import "./namespace.css";

const UserPage = () => {
  const { user } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  const { email, dateJoined, projects, notFound, isLoading } = useSelector(
    (state) => state.user
  );

  useEffect(() => {
    dispatch(fetchUserData(user));
  }, [dispatch, user]);

  useEffect(() => {
    if (notFound) {
      navigate("/404");
    }
  }, [notFound, navigate]);

  const formattedDate = useMemo(() => {
    if (!dateJoined) return "Unknown";
    return new Date(dateJoined).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [dateJoined]);

  if (isLoading) {
    return (
      <Container className="namespace-loading">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
        <p className="namespace-loading-text">Loading user profile...</p>
      </Container>
    );
  }

  return (
    <Container className="namespace-container">
      <Row>
        {/* Sidebar */}
        <Col lg={3} md={4}>
          <div className="namespace-sidebar">
            <div className="namespace-card">
              <img
                className="namespace-avatar"
                alt={`Avatar for ${user}`}
                src={`https://www.gravatar.com/avatar/${user}?d=identicon&s=200`}
              />
              
              <h1 className="namespace-title">{user}</h1>
              
              <ul className="namespace-info-list">
                <li className="namespace-info-item">
                  <PersonCircle className="namespace-info-icon" />
                  <span className="namespace-info-label">User Profile</span>
                </li>
                
                <li className="namespace-info-item">
                  <CalendarEvent className="namespace-info-icon" />
                  <span className="namespace-info-value">{formattedDate}</span>
                </li>
                
                {email && (
                  <li className="namespace-info-item">
                    <Envelope className="namespace-info-icon" />
                    <span className="namespace-info-value" style={{ fontSize: "0.9rem" }}>{email}</span>
                  </li>
                )}
              </ul>
            </div>
          </div>
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
                <Archive className="no-packages-icon" size={48} />
                <p>No packages from this user yet.</p>
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

export default UserPage;
