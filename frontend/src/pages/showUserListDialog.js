import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Card, Modal, Spinner, Alert } from "react-bootstrap";
import { fetchUserListData } from "../store/actions/userListActions";
import { Person } from "react-bootstrap-icons";
import { Link } from "react-router-dom";

const ShowUserListDialog = ({
  show,
  onHide,
  admins,
  maintainers,
  packagemaintainers,
  namespace,
  package: packageName,
}) => {
  const dispatch = useDispatch();
  
  const { users, error, isLoading } = useSelector((state) => state.userList);
  const uuid = useSelector((state) => state.auth.uuid);

  // Compute title based on dialog type
  const title = useMemo(() => {
    if (admins) return "Namespace Admins";
    if (maintainers) return "Namespace Maintainers";
    return "Package Maintainers";
  }, [admins, maintainers]);

  useEffect(() => {
    if (!show) return;

    dispatch(
      fetchUserListData({
        namespaceAdmins: admins,
        namespaceMaintainers: maintainers,
        packageMaintainers: packagemaintainers,
        namespace,
        packageName,
        uuid,
      })
    );
  }, [show, dispatch, admins, maintainers, packagemaintainers, namespace, packageName, uuid]);

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {isLoading && (
          <div className="text-center py-4">
            <Spinner animation="border" role="status">
              <span className="visually-hidden">Loading...</span>
            </Spinner>
          </div>
        )}

        {error && (
          <Alert variant="danger">
            <i className="fas fa-exclamation-circle me-2" />
            {error}
          </Alert>
        )}

        {!isLoading && users && users.length === 0 && (
          <div className="text-center text-muted py-3">
            <i className="fas fa-users fa-2x mb-2 d-block" />
            No users found
          </div>
        )}

        {!isLoading && users && users.map((user) => (
          <Card key={user.id} className="mb-2">
            <Card.Body className="d-flex align-items-center py-2">
              <Person className="me-2 text-muted" />
              <Link
                to={`/users/${user.username}`}
                className="text-decoration-none"
              >
                {user.username}
              </Link>
            </Card.Body>
          </Card>
        ))}
      </Modal.Body>
    </Modal>
  );
};

export default ShowUserListDialog;
