import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";
import InputGroup from "react-bootstrap/InputGroup";
import Form from "react-bootstrap/Form";
import {
  generatePackageToken,
  resetMessages,
} from "../store/actions/generatePackageTokenActions";

const GeneratePackageTokenDialogForm = ({ namespace, package: packageName, show, onHide }) => {
  const [copied, setCopied] = useState(false);
  const dispatch = useDispatch();
  
  const accessToken = useSelector((state) => state.auth.accessToken);
  const { successMessage, errorMessage, uploadToken, isLoading } = useSelector(
    (state) => state.generatePackageToken
  );

  const handleGenerate = useCallback((e) => {
    e.preventDefault();

    if (!accessToken) {
      return;
    }

    dispatch(
      generatePackageToken({
        accessToken,
        namespace,
        package: packageName,
      })
    );
  }, [dispatch, accessToken, namespace, packageName]);

  const handleCopy = useCallback(() => {
    if (uploadToken) {
      navigator.clipboard.writeText(uploadToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [uploadToken]);

  const resetData = useCallback(() => {
    setCopied(false);
    dispatch(resetMessages());
  }, [dispatch]);

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="md"
      aria-labelledby="generate-package-token-modal"
      centered
      onExited={resetData}
    >
      <Modal.Header closeButton>
        <Modal.Title id="generate-package-token-modal">
          Generate Package Token
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-3">
          Generate an upload token for package <strong>{namespace}/{packageName}</strong>.
        </p>
        <p className="text-muted small mb-3">
          This token can be used to upload new versions of this package via the CLI.
        </p>

        {uploadToken && (
          <div className="mb-3">
            <Form.Label className="text-success">
              <i className="fas fa-check-circle me-2" />
              Token Generated Successfully
            </Form.Label>
            <InputGroup>
              <Form.Control
                type="text"
                value={uploadToken}
                readOnly
                className="font-monospace"
              />
              <Button
                variant={copied ? "success" : "outline-secondary"}
                onClick={handleCopy}
              >
                {copied ? (
                  <><i className="fas fa-check me-1" /> Copied</>
                ) : (
                  <><i className="fas fa-copy me-1" /> Copy</>
                )}
              </Button>
            </InputGroup>
            <Form.Text className="text-muted">
              Keep this token secure. It won't be shown again.
            </Form.Text>
          </div>
        )}

        {successMessage && !uploadToken && (
          <Alert variant="success" className="mb-0">
            <i className="fas fa-check-circle me-2" />
            {successMessage}
          </Alert>
        )}
        {errorMessage && (
          <Alert variant="danger" className="mb-0">
            <i className="fas fa-exclamation-circle me-2" />
            {errorMessage}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Close
        </Button>
        {!uploadToken && (
          <Button
            variant="success"
            onClick={handleGenerate}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Generating...
              </>
            ) : (
              <>
                <i className="fas fa-key me-2" />
                Generate Token
              </>
            )}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default GeneratePackageTokenDialogForm;
