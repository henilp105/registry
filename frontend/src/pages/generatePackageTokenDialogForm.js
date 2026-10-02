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
import Icon from "../components/Icon";
import { useCopyToClipboard } from "../utils/useCopyToClipboard";

const GeneratePackageTokenDialogForm = ({ namespace, package: packageName, show, onHide }) => {
  const [copied, copyToClipboard, clearCopied] = useCopyToClipboard();
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
    if (uploadToken) copyToClipboard(uploadToken);
  }, [uploadToken, copyToClipboard]);

  const resetData = useCallback(() => {
    clearCopied();
    dispatch(resetMessages());
  }, [dispatch, clearCopied]);

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
              <Icon name="check-circle" className="me-2" />
              Token Generated Successfully
            </Form.Label>
            <InputGroup>
              {/* `aria-label` rather than a visible label: the value is a secret and
                  a visible caption above it would be noise, but the field still
                  needs a name -- a screen reader otherwise announces a bare text
                  box, and the user cannot tell it apart from the other inputs in
                  the dialog. Defect D70. */}
              <Form.Control
                type="text"
                value={uploadToken}
                readOnly
                aria-label="Generated upload token"
                className="font-monospace"
              />
              <Button
                variant={copied ? "success" : "outline-secondary"}
                onClick={handleCopy}
              >
                {copied ? (
                  <><Icon name="check" className="me-1" /> Copied</>
                ) : (
                  <><Icon name="copy" className="me-1" /> Copy</>
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
            <Icon name="check-circle" className="me-2" />
            {successMessage}
          </Alert>
        )}
        {errorMessage && (
          <Alert variant="danger" className="mb-0">
            <Icon name="exclamation-circle" className="me-2" />
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
                <Icon name="key" className="me-2" />
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
