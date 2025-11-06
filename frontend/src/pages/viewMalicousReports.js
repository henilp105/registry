import { useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Card, Modal, Spinner, Alert } from "react-bootstrap";
import {
  fetchMalicousReports,
  resetData,
} from "../store/actions/viewMalicousReportActions";

const ViewMalicousReports = ({ show, onHide }) => {
  const dispatch = useDispatch();
  
  const accessToken = useSelector((state) => state.auth.accessToken);
  const { reports, isLoading, error } = useSelector((state) => state.malicousReport);

  useEffect(() => {
    if (!show) return;
    dispatch(fetchMalicousReports(accessToken));
  }, [show, accessToken, dispatch]);

  const handleExit = useCallback(() => {
    dispatch(resetData());
  }, [dispatch]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="d-flex justify-content-center py-4">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Loading...</span>
          </Spinner>
        </div>
      );
    }

    if (error) {
      return (
        <Alert variant="danger">
          <i className="fas fa-exclamation-circle me-2" />
          {error}
        </Alert>
      );
    }

    if (reports.length === 0) {
      return (
        <Alert variant="info">
          <i className="fas fa-info-circle me-2" />
          No malicious reports found.
        </Alert>
      );
    }

    return reports.map((report, index) => (
      <Card key={index} className="mb-3">
        <Card.Body>
          <Card.Title className="h6">
            <i className="fas fa-folder me-2" />
            {report.namespace}/{report.package}
          </Card.Title>
          <Card.Text className="text-muted">
            {report.reason}
          </Card.Text>
        </Card.Body>
      </Card>
    ));
  };

  return (
    <Modal 
      show={show} 
      onHide={onHide} 
      onExited={handleExit}
      size="lg"
      centered
    >
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="fas fa-flag me-2" />
          Malicious Reports
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {renderContent()}
      </Modal.Body>
    </Modal>
  );
};

export default ViewMalicousReports;
