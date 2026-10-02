import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Table from "react-bootstrap/Table";
import Nav from "react-bootstrap/Nav";
import Tab from "react-bootstrap/Tab";
import { Button } from "react-bootstrap";
import {
  fetchPackageData,
  verifyUserRole,
} from "../store/actions/packageActions";
import ShowUserListDialog from "./showUserListDialog";
import ReportPackageForm from "./reportPackageForm";
import RatePackageForm from "./ratePackageForm";
import PackageRatingGraph from "./packageRatingGraph";
import Markdown from "react-markdown";
import { Skeleton, SkeletonText } from "../components/SkeletonLoader";
import Icon from "../components/Icon";
import { safeUrl } from "../utils/safeUrl";
import "./package.css";

/* The four tabs. `eventKey` doubles as the value the activeTab state holds,
 * so adding a tab is a one-line change here and the ARIA wiring below picks
 * it up. */
const TABS = [
  { key: "readme", label: "Readme", icon: "readme" },
  { key: "dependencies", label: "Dependencies", icon: "boxes" },
  { key: "versions", label: "Versions", icon: "tag" },
  { key: "stats", label: "Stats", icon: "chart-bar" },
];

// Skeleton component for package loading state
const PackageSkeleton = () => (
  <Container className="package-page package-page--loading">
    <div className="d-flex justify-content-between align-items-start mb-3">
      <div>
        <Skeleton width="300px" height="32px" className="mb-2" />
        <Skeleton width="200px" height="20px" />
      </div>
      <Skeleton width="180px" height="40px" className="skeleton-pill" />
    </div>

    <div className="mb-4">
      <Skeleton width="100%" height="50px" className="mb-3" />
    </div>

    <Row>
      <Col md={9}>
        <SkeletonText lines={8} />
      </Col>
      <Col md={3}>
        <Skeleton width="100%" height="20px" className="mb-2" />
        <Skeleton width="80%" height="16px" className="mb-3" />
        <Skeleton width="100%" height="1px" className="mb-3" />
        <Skeleton width="100%" height="20px" className="mb-2" />
        <Skeleton width="60%" height="16px" className="mb-3" />
        <Skeleton width="100%" height="1px" className="mb-3" />
        <Skeleton width="100%" height="20px" className="mb-2" />
        <Skeleton width="70%" height="16px" />
      </Col>
    </Row>
  </Container>
);

const PackagePage = () => {
  const [activeTab, setActiveTab] = useState("readme");
  const { namespace_name, package_name } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const statuscode = useSelector((state) => state.package.statuscode);
  // The transport status, distinct from the body's `code`. Needed because the
  // three failure states below are told apart by status, not by message.
  const httpStatus = useSelector((state) => state.package.httpStatus);
  const retryAfter = useSelector((state) => state.package.retryAfter);
  const data = useSelector((state) => state.package.data);
  const isLoading = useSelector((state) => state.package.isLoading);

  const [togglePackageMaintainersDialog, setTogglePackageMaintainersDialog] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [showRateForm, setShowRateForm] = useState(false);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);

  const handleTabClick = useCallback((value) => {
    if (value !== activeTab) {
      setActiveTab(value);
    }
  }, [activeTab]);

  const copyInstallCommand = useCallback(() => {
    const command = `${data.name} = {'namespace'='${data.namespace}'}`;
    navigator.clipboard.writeText(command).then(() => {
      setCopiedToClipboard(true);
      setTimeout(() => setCopiedToClipboard(false), 2000);
    });
  }, [data?.name, data?.namespace]);

  useEffect(() => {
    dispatch(fetchPackageData(namespace_name, package_name));
  }, [dispatch, namespace_name, package_name]);

  useEffect(() => {
    if (statuscode === 404) {
      navigate("/404");
    }
  }, [statuscode, navigate]);

  /**
   * Re-fetch after a transient failure.
   *
   * Offered for the rate-limited, offline and server-error states, and
   * deliberately not for the not-found state -- retrying a package that does not
   * exist cannot succeed, and offering it implies otherwise.
   */
  const retry = useCallback(() => {
    dispatch(fetchPackageData(namespace_name, package_name));
  }, [dispatch, namespace_name, package_name]);

  // Memoized sorted versions
  const sortedVersionsList = useMemo(() => {
    if (!data?.version_history) return [];
    return sortVersions(data.version_history);
  }, [data?.version_history]);

  if (isLoading) {
    return <PackageSkeleton />;
  }

  if (!data) {
    // Three different truths, previously collapsed into one.
    //
    // The old branch rendered "Package not found — doesn't exist or has been
    // removed" for *every* failure, because `data` is null for all of them. So a
    // 429 told the user their package had been deleted, a 500 told them the same,
    // and so did a dropped connection. That is actively alarming and simply false,
    // and it became reachable the moment rate limiting shipped: a burst of
    // requests is now a normal event, and each one would have announced a
    // deletion that did not happen.
    //
    // Reproduced by injecting each failure against the running app.
    const isRateLimited = httpStatus === 429;
    const isOffline = httpStatus === 0;
    const notFound = httpStatus === 404 || statuscode === 404;

    if (isRateLimited) {
      return (
        <Container className="package-page package-empty">
          <Icon name="hourglass-half" size={48} className="package-empty__icon" />
          <h1 className="package-empty__title">Too many requests</h1>
          <p className="text-muted">
            You have sent a lot of requests in a short time, so this one was held
            back to keep the registry responsive for everyone. Nothing is wrong
            with the package.
            {retryAfter ? ` Try again in ${retryAfter} seconds.` : ""}
          </p>
          <Link to="/search" className="btn btn-primary mt-3">
            Browse Packages
          </Link>
        </Container>
      );
    }

    if (isOffline) {
      return (
        <Container className="package-page package-empty">
          <Icon name="wifi" size={48} className="package-empty__icon" />
          <h1 className="package-empty__title">Could not reach the registry</h1>
          <p className="text-muted">
            The request did not get a reply at all, which usually means a dropped
            connection rather than a missing package. Check your network and try
            again.
          </p>
          <button type="button" className="btn btn-primary mt-3" onClick={retry}>
            Try again
          </button>
        </Container>
      );
    }

    if (!notFound) {
      return (
        <Container className="package-page package-empty">
          <Icon name="exclamation-triangle" size={48} className="package-empty__icon" />
          <h1 className="package-empty__title">Could not load this package</h1>
          <p className="text-muted">
            The registry had a problem answering that request. This is on our side,
            not yours, and the package has not been changed.
          </p>
          <button type="button" className="btn btn-primary mt-3" onClick={retry}>
            Try again
          </button>
        </Container>
      );
    }

    return (
      <Container className="package-page package-empty">
        <Icon name="exclamation-triangle" size={48} className="package-empty__icon" />
        <h1 className="package-empty__title">Package not found</h1>
        <p className="text-muted">
          The package you&apos;re looking for doesn&apos;t exist or has been
          removed.
        </p>
        <Link to="/search" className="btn btn-primary mt-3">
          Browse Packages
        </Link>
      </Container>
    );
  }

  return (
    <Container className="package-page">
      {/* Package Header */}
      <header className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
        <div>
          <h1 className="package-title">
            <Link to={`/namespaces/${data.namespace}`} className="package-title__namespace">
              {data.namespace}
            </Link>
            <span className="package-title__separator" aria-hidden="true">/</span>
            <span>{data.name}</span>
          </h1>
          <p className="package-subtitle">
            <Icon name="tag" className="me-1" />
            <span className="font-mono">v{data.latest_version_data?.version}</span>
            <span className="mx-2" aria-hidden="true">•</span>
            <Icon name="clock" className="me-1" />
            Published {formatTimeAgo(data.updated_at)}
          </p>
        </div>

        <ViewPackageMaintainersButton
          namespace_name={namespace_name}
          package_name={package_name}
          onShowMaintainers={() => setTogglePackageMaintainersDialog(true)}
        />

        <ShowUserListDialog
          packagemaintainers={true}
          show={togglePackageMaintainersDialog}
          onHide={() => setTogglePackageMaintainersDialog(false)}
          package={package_name}
          namespace={namespace_name}
        />
      </header>

      {/*
        react-bootstrap Nav + Tab rather than the MDBTabs family this used to
        use. MDBTabsLink renders an anchor with no href, so no tab was keyboard
        reachable and the tab/tabpanel relationship was not exposed at all.
        Nav/Tab emit role="tab"/"tablist"/"tabpanel" with aria-selected and
        arrow-key navigation.
      */}
      <Tab.Container activeKey={activeTab} onSelect={handleTabClick}>
        <Nav variant="tabs" className="package-tabs mb-4">
          {TABS.map(({ key, label, icon }) => (
            <Nav.Item key={key}>
              <Nav.Link eventKey={key} className="package-tabs__link">
                <Icon name={icon} className="me-2" />
                {label}
                {key === "versions" && data.version_history?.length > 0 && (
                  <span className="badge bg-secondary ms-2">
                    {data.version_history.length}
                  </span>
                )}
              </Nav.Link>
            </Nav.Item>
          ))}
        </Nav>

        <Tab.Content>
          <Tab.Pane eventKey="readme">
            <Row>
              <Col md={9} className="mb-4">
                <article className="readme-content">
                  <Markdown>{data.registry_description || "*No readme available*"}</Markdown>
                </article>
              </Col>
              <PackageSidebar
                data={data}
                onRate={() => setShowRateForm(true)}
                onReport={() => setShowReportForm(true)}
                onCopyInstall={copyInstallCommand}
                copiedToClipboard={copiedToClipboard}
              />
            </Row>
          </Tab.Pane>

          <Tab.Pane eventKey="dependencies">
            <Row>
              <Col md={9} className="mb-4">
                <p className="text-muted mt-3">
                  <Icon name="info-circle" className="me-2" />
                  Dependency information is parsed from the package manifest.
                </p>
              </Col>
              <PackageSidebar data={data} />
            </Row>
          </Tab.Pane>

          <Tab.Pane eventKey="versions">
            <Row>
              <Col md={9} className="mb-4">
                {sortedVersionsList.length > 0 ? (
                  <Table hover responsive className="mt-3 package-versions">
                    <thead>
                      <tr>
                        <th scope="col">Version</th>
                        <th scope="col">Published</th>
                        <th scope="col">Status</th>
                        <th scope="col">Download</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedVersionsList.map((ver, index) => (
                        <tr key={ver.version}>
                          <td>
                            <span className={index === 0 ? "fw-bold" : ""}>
                              <span className="font-mono">v{ver.version}</span>
                              {index === 0 && (
                                <span className="badge bg-success ms-2">Latest</span>
                              )}
                            </span>
                          </td>
                          <td>{formatTimeAgo(ver.created_at)}</td>
                          <td>
                            {ver.isDeprecated === "true" ? (
                              <span className="badge bg-warning text-dark">
                                <Icon name="exclamation-triangle" className="me-1" size={12} />
                                Deprecated
                              </span>
                            ) : (
                              <span className="badge bg-success">Active</span>
                            )}
                          </td>
                          <td>
                            {ver.download_url && safeUrl(`${process.env.REACT_APP_REGISTRY_API_URL}${ver.download_url}`) ? (
                              <a
                                href={`${process.env.REACT_APP_REGISTRY_API_URL}${ver.download_url}`}
                                className="btn btn-sm btn-outline-primary"
                                download
                              >
                                <Icon name="download" className="me-1" size={13} />
                                Download
                              </a>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <p className="text-muted">No version history available.</p>
                )}
              </Col>
              <PackageSidebar data={data} />
            </Row>
          </Tab.Pane>

          <Tab.Pane eventKey="stats">
            <h2 className="package-section-title">Package Statistics</h2>
            <PackageRatingGraph data={data.ratings_count} />
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>

      {/* Dialogs */}
      <RatePackageForm
        namespace={namespace_name}
        package={package_name}
        show={showRateForm}
        onHide={() => setShowRateForm(false)}
      />
      <ReportPackageForm
        namespace={namespace_name}
        package={package_name}
        show={showReportForm}
        onHide={() => setShowReportForm(false)}
      />
    </Container>
  );
};

export default PackagePage;

// View Package Maintainers Button Component
const ViewPackageMaintainersButton = ({
  namespace_name,
  package_name,
  onShowMaintainers,
}) => {
  const dispatch = useDispatch();
  const uuid = useSelector((state) => state.auth.uuid);

  useEffect(() => {
    if (uuid) {
      dispatch(verifyUserRole(namespace_name, package_name, uuid));
    }
  }, [dispatch, uuid, namespace_name, package_name]);

  return (
    <button
      type="button"
      className="btn btn-outline-success btn-pill"
      onClick={onShowMaintainers}
    >
      <Icon name="users" className="me-2" />
      View Package Maintainers
    </button>
  );
};

// Package Sidebar Component
const PackageSidebar = ({ data, onRate, onReport, onCopyInstall, copiedToClipboard }) => {
  const installCommand = `${data.name} = {'namespace'='${data.namespace}'}`;

  return (
    <Col md={3}>
      {/* Install Section */}
      <div className="mb-4">
        <h6 className="package-sidebar__heading">
          <Icon name="download" className="me-2" size={13} />
          Install
        </h6>
        <p className="small text-muted mb-1">Add to fpm.toml:</p>
        <div className="position-relative">
          <code className="package-install-command d-block">
            {installCommand}
          </code>
          {onCopyInstall && (
            <button
              type="button"
              className="btn btn-sm btn-link package-install-command__copy"
              onClick={onCopyInstall}
              aria-label="Copy install command"
            >
              <Icon name={copiedToClipboard ? "check" : "copy"} />
            </button>
          )}
        </div>
        {/* Announced on copy, so a screen-reader user learns the clipboard
            action succeeded rather than only sighted users seeing the swap. */}
        <small className="text-success" role="status">
          {copiedToClipboard ? "Copied to clipboard!" : ""}
        </small>
      </div>

      <hr />

      {/* Repository — scheme-checked: package metadata is attacker-controlled,
          and a `javascript:` URL here would run in the registry's origin. */}
      {safeUrl(data.repository) && (
        <>
          <div className="mb-3">
            <h6 className="package-sidebar__heading">
              <Icon name="code-branch" className="me-2" size={13} />
              Repository
            </h6>
            <a
              href={safeUrl(data.repository)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-break font-mono package-sidebar__value"
            >
              {data.repository}
            </a>
          </div>
          <hr />
        </>
      )}

      {/* Homepage */}
      {safeUrl(data.homepage) && (
        <>
          <div className="mb-3">
            <h6 className="package-sidebar__heading">
              <Icon name="home" className="me-2" size={13} />
              Homepage
            </h6>
            <a
              href={safeUrl(data.homepage)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-break"
            >
              {data.homepage}
            </a>
          </div>
          <hr />
        </>
      )}

      {/* License */}
      <div className="mb-3">
        <h6 className="package-sidebar__heading">
          <Icon name="balance-scale" className="me-2" size={13} />
          License
        </h6>
        <span>{data.license || "Not specified"}</span>
      </div>

      <hr />

      {/* Version */}
      <div className="mb-3">
        <h6 className="package-sidebar__heading">
          <Icon name="tag" className="me-2" size={13} />
          Version
        </h6>
        <span className="font-mono">v{data.latest_version_data?.version}</span>
      </div>

      <hr />

      {/* Last Published */}
      <div className="mb-3">
        <h6 className="package-sidebar__heading">
          <Icon name="calendar-alt" className="me-2" size={13} />
          Last Published
        </h6>
        <span>{formatTimeAgo(data.updated_at)}</span>
      </div>

      {/* Action Buttons */}
      {(onRate || onReport) && (
        <>
          <hr />
          <div className="d-flex gap-2">
            {onRate && (
              <Button
                variant="success"
                size="sm"
                onClick={onRate}
                className="flex-grow-1"
              >
                <Icon name="star" className="me-1" size={13} />
                Rate
              </Button>
            )}
            {onReport && (
              <Button
                variant="outline-danger"
                size="sm"
                onClick={onReport}
                className="flex-grow-1"
              >
                <Icon name="flag" className="me-1" size={13} />
                Report
              </Button>
            )}
          </div>
        </>
      )}
    </Col>
  );
};

// Utility functions
const formatTimeAgo = (date) => {
  const updatedDate = new Date(date);
  const currentDate = new Date();
  const diffTime = currentDate.getTime() - updatedDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

const sortVersions = (versions) => {
  if (!versions) return [];
  return [...versions].sort((a, b) => {
    const [aMajor, aMinor, aPatch] = a.version.split(".").map(Number);
    const [bMajor, bMinor, bPatch] = b.version.split(".").map(Number);

    if (aMajor !== bMajor) return bMajor - aMajor;
    if (aMinor !== bMinor) return bMinor - aMinor;
    return bPatch - aPatch;
  });
};
