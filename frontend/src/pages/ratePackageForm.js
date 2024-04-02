import React, { useEffect, useState } from "react";
import { Form, Button, Modal, Spinner } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { toast, ToastContainer } from "react-toastify";
import {
  ratePackage,
  resetErrorMessage,
} from "../store/actions/ratePackageActions";

const RatePackageForm = (props) => {
  const dispatch = useDispatch();
  const [rating, setRating] = useState("");
  const accessToken = useSelector((state) => state.auth.accessToken);
  const isLoading = useSelector((state) => state.ratePackage.isLoading);
  const statusCode = useSelector((state) => state.ratePackage.statuscode);
  const message = useSelector((state) => state.ratePackage.message);

  const handleSubmit = async (e) => {
    e.preventDefault();
    dispatch(
      ratePackage(
        { rating: rating, namespace: props.namespace, package: props.package },
        accessToken
      )
    );
  };

  useEffect(() => {
    if (statusCode === 200) {
      toast.success(message);
    } else {
      toast.error(message);
    }

    dispatch(resetErrorMessage());
  }, [statusCode]);

  return (
    <Form onSubmit={handleSubmit}>
      <Modal {...props} size="md">
        <Modal.Header closeButton>
          <Modal.Title>Rate Package</Modal.Title>
        </Modal.Header>
        <ToastContainer
          position="top-center"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          pauseOnHover
          theme="light"
        />
        <Modal.Body>
          <Form.Group className="mb-3" controlId="formRatePackage">
            <Form.Label>Please rate this package on a scale of 1-5</Form.Label>
            <Form.Control
              type="number"
              placeholder="Enter rating"
              min={1}
              max={5}
              value={rating}
              onChange={(e) => setRating(e.target.value)}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          {!isLoading ? (
            <Button variant="primary" type="submit" onClick={handleSubmit}>
              Rate
            </Button>
          ) : (
            <div style={{ margin: 0 }}>
              <Spinner
                className="spinner-border m-3"
                animation="border"
                role="status"
              >
                <span className="visually-hidden">Loading...</span>
              </Spinner>
            </div>
          )}
        </Modal.Footer>
      </Modal>
    </Form>
  );
};

export default RatePackageForm;
