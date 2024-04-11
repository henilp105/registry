import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Card, Modal } from "react-bootstrap";
import { fetchUserListData } from "../store/actions/userListActions";
import { MDBIcon } from "mdbreact";

const ShowUserListDialog = (props) => {
  const users = useSelector((state) => state.userList.users);
  const uuid = useSelector((state) => state.auth.uuid);
  const error = useSelector((state) => state.userList.error);

  const dispatch = useDispatch();

  useEffect(() => {
    if (!props.show) {
      return;
    }

    dispatch(
      fetchUserListData({
        namespaceAdmins: props.admins,
        namespaceMaintainers: props.maintainers,
        packageMaintainers: props.packagemaintainers,
        namespace: props.namespace,
        packageName: props.package,
        uuid: uuid,
      })
    );
  }, [props.show]);

  return (
    <>
      <Modal show={props.show} onHide={props.onHide}>
        <Modal.Header closeButton>
          <Modal.Title>
            {(props.admins && "Namespace Admins") ||
              (props.maintainers && "Namespace Maintainers") ||
              "Package Maintainers"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {error ? <p className="error">{error}</p> : null}
          {users && users.length === 0 ? <p>No users found</p> : null}
          {users &&
            users.map((user, index) => {
              return (
                <Card
                  key={user.id}
                  style={{
                    marginBottom: "10px",
                  }}
                >
                  <Card.Body
                    style={{
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <MDBIcon
                      style={{
                        paddingRight: "10px",
                      }}
                      fas
                      icon="user"
                    />
                    <h6
                      style={{
                        marginBottom: "0",
                      }}
                    >
                      
                    <a
                        href={`/users/${user.username}`}
                        style={{ textDecoration: "none" }}
                      >
                        {user.username}
                      </a>
                    </h6>
                  </Card.Body>
                </Card>
              );
            })}
        </Modal.Body>
      </Modal>
    </>
  );
};

export default ShowUserListDialog;
