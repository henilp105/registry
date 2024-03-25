import React, { useState, useEffect } from "react";
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
  const dateJoined = useSelector((state) => state.namespace.dateJoined);
  const projects = useSelector((state) => state.namespace.projects);
  const notFound = useSelector((state) => state.namespace.notFound);
  const isLoading = useSelector((state) => state.namespace.isLoading);
  const dispatch = useDispatch();

  const [isListDialogOpen, setListDialogOpen] = useState(false);
  const [findNamespaceAdmins, setFindNamespaceAdmins] = useState(false);
  const [findNamespaceMaintainers, setFindNamespaceMaintainers] =
    useState(false);

  useEffect(() => {
    dispatch(fetchNamespaceData(namespace));
  }, [namespace, notFound]);

  if (notFound) {
    navigate("/404");
  }

  return !isLoading ? (
    <Container>
      <Row>
        <Col sm={4}>
          <Row style={{ marginLeft: "10px", marginTop: "20px" }}>
            <Figure>
              <Figure.Image
                width={171}
                height={180}
                alt={`Avatar for ${namespace} from gravatar.com`}
                src={`https://www.gravatar.com/avatar/${namespace}`} // render image from Storage Service
              />
            </Figure>
          </Row>
          <Row
            style={{ marginLeft: "10px", marginTop: "10px", fontSize: "20px" }}
          >
            <MDBIcon style={{ marginTop: "5px" }} far icon="box">
              {" Namespace: " + namespace}
            </MDBIcon>
            <br></br>
            <MDBIcon style={{ marginTop: "5px" }} far icon="calendar-alt">
              {" Created " + dateJoined.slice(4, 16)}
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
              onClick={() => {
                setFindNamespaceMaintainers(false);
                setFindNamespaceAdmins(true);
                setListDialogOpen(true);
              }}
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
              onClick={() => {
                setFindNamespaceMaintainers(true);
                setFindNamespaceAdmins(false);
                setListDialogOpen(true);
              }}
            >
              {" "}
              Namespace Maintainers
            </MDBIcon>
          </Row>
          {findNamespaceAdmins || findNamespaceMaintainers ? (
            <ShowUserListDialog
              maintainers={findNamespaceMaintainers}
              admins={findNamespaceAdmins}
              onHide={() => setListDialogOpen(false)}
              namespace={namespace}
              show={isListDialogOpen}
            />
          ) : null}
        </Col>
        <Col sm={8}>
          <Row style={{ fontSize: 24, marginTop: "20px" }}>
            {projects.length === 0
              ? "0 projects"
              : projects.length + " Packages"}
          </Row>
          {projects.map((packageEntity) => (
            <PackageItem
              key={packageEntity.name + packageEntity.namespace}
              packageEntity={packageEntity}
            />
          ))}
        </Col>
      </Row>
    </Container>
  ) : (
    <Container style={{ margin: "200px" }}>
      <Spinner animation="border" role="status">
        <span className="visually-hidden">Loading...</span>
      </Spinner>
    </Container>
  );
};

export default NamespacePage;
