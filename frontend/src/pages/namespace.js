import React, { useState, useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchNamespaceData } from "../store/actions/namespaceActions";
import { MDBIcon } from "mdbreact";
import { useNavigate, useParams } from "react-router-dom";
import Container from "react-bootstrap/Container";
import Figure from "react-bootstrap/Figure";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Spinner from "react-bootstrap/Spinner";
import PackageItem from "../components/packageItem";
import "./upload.css";
import ShowUserListDialog from "./showUserListDialog";

const NamespacePage = () => {
  const { namespace } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  const { dateJoined, projects, notFound, isLoading } = useSelector(
    (state) => state.namespace
  );

  const [isListDialogOpen, setListDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState(null); // 'admins' | 'maintainers'

  // Fetch namespace data on mount or namespace change
  useEffect(() => {
    dispatch(fetchNamespaceData(namespace));
  }, [dispatch, namespace]);

  // Handle 404 redirect
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

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return "";
    return dateString.slice(4, 16);
  };

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
                width={100}
                height={100}
                alt={`Avatar for ${namespace} from gravatar.com`}
                src={`https://www.gravatar.com/avatar/${namespace}`}
              />
            </Figure>
          </Row>
          <Row
            style={{ marginLeft: "10px", marginTop: "10px", fontSize: "20px" }}
          >
            <MDBIcon style={{ marginTop: "5px" }} far icon="box">
              {` Namespace: ${namespace}`}
            </MDBIcon>
            <br />
            <MDBIcon style={{ marginTop: "5px" }} far icon="calendar-alt">
              {` Created: ${formatDate(dateJoined)}`}
            </MDBIcon>
          </Row>
          <Row
            style={{
              marginLeft: "10px",
              marginTop: "10px",
              fontSize: "20px",
              cursor: "pointer",
            }}
          >
            <MDBIcon
              style={{ marginTop: "5px" }}
              far
              icon="user"
              onClick={() => openDialog('admins')}
            >
              {" "}
              Admins
            </MDBIcon>
          </Row>
          <Row
            style={{
              marginLeft: "10px",
              marginTop: "10px",
              fontSize: "20px",
              cursor: "pointer",
            }}
          >
            <MDBIcon
              style={{ marginTop: "5px" }}
              far
              icon="user"
              onClick={() => openDialog('maintainers')}
            >
              {" "}
              Namespace Maintainers
            </MDBIcon>
          </Row>
          
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
        <Col sm={8}>
          <Row style={{ fontSize: 24, marginTop: "20px" }}>
            {projects.length === 0
              ? "0 projects"
              : `${projects.length} Packages`}
          </Row>
          {projects.map((packageEntity) => (
            <Row key={`${packageEntity.namespace}-${packageEntity.name}`} style={{ marginTop: "20px" }}>
              <PackageItem packageEntity={packageEntity} />
            </Row>
          ))}
        </Col>
      </Row>
    </Container>
  );
};

export default NamespacePage;
