import React, { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchUserData } from "../store/actions/userActions";
import { PersonCircle, CalendarEvent, Envelope } from "react-bootstrap-icons";
import { useNavigate, useParams } from "react-router-dom";
import Container from "react-bootstrap/Container";
import Figure from "react-bootstrap/Figure";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Spinner from "react-bootstrap/Spinner";
import PackageItem from "../components/packageItem";

const UserPage = () => {
  const { user } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  const { email, dateJoined, projects, notFound, isLoading } = useSelector(
    (state) => state.user
  );

  // Fetch user data on mount or user change
  useEffect(() => {
    dispatch(fetchUserData(user));
  }, [dispatch, user]);

  // Handle 404 redirect
  useEffect(() => {
    if (notFound) {
      navigate("/404");
    }
  }, [notFound, navigate]);

  // Format date for display
  const formattedDate = useMemo(() => {
    if (!dateJoined) return "";
    return new Date(dateJoined).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [dateJoined]);

  if (isLoading) {
    return (
      <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: "400px" }}>
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </Container>
    );
  }

  return (
    <Container>
      <Row>
        <Col sm={4}>
          <Row style={{ marginLeft: "10px", marginTop: "20px" }}>
            <Figure>
              <Figure.Image
                width={171}
                height={180}
                alt={`Avatar for ${user} from gravatar.com`}
                src={`https://www.gravatar.com/avatar/${user}`}
              />
            </Figure>
          </Row>
          <Row
            style={{ marginLeft: "10px", marginTop: "10px", fontSize: "20px" }}
          >
            <div className="d-flex align-items-center mb-2">
              <PersonCircle style={{ marginRight: "8px" }} />
              {user}
            </div>
            <div className="d-flex align-items-center mb-2">
              <CalendarEvent style={{ marginRight: "8px" }} />
              {`Joined ${formattedDate}`}
            </div>
            <div className="d-flex align-items-center mb-2">
              <Envelope style={{ marginRight: "8px" }} />
              {email}
            </div>
          </Row>
        </Col>
        <Col sm={8}>
          <Row style={{ fontSize: "20px", marginTop: "20px", padding: "5px" }}>
            {projects.length === 0
              ? "0 projects"
              : `${projects.length} projects`}
          </Row>
          {projects.map((packageEntity) => (
            <PackageItem
              key={`${packageEntity.namespace}-${packageEntity.name}`}
              packageEntity={packageEntity}
            />
          ))}
        </Col>
      </Row>
    </Container>
  );
};

export default UserPage;
