import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useCookies } from "react-cookie";
import { fetchPackages } from "../store/actions/dashboardActions";
import { useNavigate } from "react-router-dom";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Container from "react-bootstrap/Container";
import AddMaintainerFormDialog from "../pages/maintainerDialogForm";

const Dashboard = () => {
  const [cookies, setCookie] = useCookies(["uuid"]);
  const [showMaintainerDialog, setShowMaintainerDialog] = useState(false);
  const username = useSelector((state) => state.auth.username);
  const packages = useSelector((state) => state.dashboard.packages);
  const isLoading = useSelector((state) => state.dashboard.isLoading);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    if (!packages) {
      dispatch(fetchPackages(username));
    }

    if (username === null) {
      navigate("/");
    }
  }, [packages, username]);

  return isLoading ? (
    <Spinner animation="border" role="status">
      <span className="visually-hidden">Loading...</span>
    </Spinner>
  ) : (
    <Container style={{ paddingTop: 25 }}>
      <p style={{ textAlign: "left", fontSize: 24 }}>Packages</p>
      <Row>
        {packages.map((element, index) => (
          <Col key={element.name + element.namespace} xs={6} md={4}>
            <Card>
              <Card.Body>
                <Card.Title>
                  <a
                    href={`/packages/${element.namespace}/${element.name}`}
                    style={{ textDecoration: "none", color: "black" }}
                  >
                    {element.name}
                  </a>
                </Card.Title>
                <Card.Subtitle className="mb-2 text-muted">
                  {element.namespace}
                </Card.Subtitle>
                <Card.Text id="card-text">{element.description}</Card.Text>
                <p style={{ textAlign: "left", fontSize: 16 }}>
                  <a
                    href={`/package/create`}
                    style={{ textDecoration: "none" }}
                  >
                    Create New Release
                  </a>
                </p>
                <span
                  style={{ textAlign: "left", fontSize: 16 }}
                  onClick={() => setShowMaintainerDialog(true)}
                >
                  Add Maintainers
                </span>
                <AddMaintainerFormDialog
                  package={element.name}
                  namespace={element.namespace}
                  show={showMaintainerDialog}
                  onHide={() => setShowMaintainerDialog(false)}
                />
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </Container>
  );
};

export default Dashboard;
