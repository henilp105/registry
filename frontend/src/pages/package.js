import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  MDBIcon,
  MDBTabs,
  MDBTabsItem,
  MDBTabsLink,
  MDBTabsContent,
  MDBTabsPane,
  MDBContainer,
  MDBRow,
  MDBCol,
  MDBTable,
  MDBTableBody,
  MDBTableHead,
} from "mdb-react-ui-kit";
import Container from "react-bootstrap/Container";
import {
  fetchPackageData,
  verifyUserRole,
} from "../store/actions/packageActions";
import ShowUserListDialog from "./showUserListDialog";
import ReportPackageForm from "./reportPackageForm";
import RatePackageForm from "./ratePackageForm";
import { Button } from "react-bootstrap";
import PackageRatingGraph from "./packageRatingGraph";
import Markdown from 'react-markdown';
import { Skeleton, SkeletonText } from "../components/SkeletonLoader";

// Skeleton component for package loading state
const PackageSkeleton = () => (
  <Container style={{ paddingTop: 25 }}>
    <div className="d-flex justify-content-between align-items-start mb-3">
      <div>
        <Skeleton width="300px" height="32px" className="mb-2" />
        <Skeleton width="200px" height="20px" />
      </div>
      <Skeleton width="180px" height="40px" style={{ borderRadius: '25px' }} />
    </div>
    
    <div className="mb-4">
      <Skeleton width="100%" height="50px" className="mb-3" />
    </div>
    
    <MDBContainer>
      <MDBRow>
        <MDBCol size="9">
          <SkeletonText lines={8} />
        </MDBCol>
        <MDBCol size="3">
          <Skeleton width="100%" height="20px" className="mb-2" />
          <Skeleton width="80%" height="16px" className="mb-3" />
          <Skeleton width="100%" height="1px" className="mb-3" />
          <Skeleton width="100%" height="20px" className="mb-2" />
          <Skeleton width="60%" height="16px" className="mb-3" />
          <Skeleton width="100%" height="1px" className="mb-3" />
          <Skeleton width="100%" height="20px" className="mb-2" />
          <Skeleton width="70%" height="16px" />
        </MDBCol>
      </MDBRow>
    </MDBContainer>
  </Container>
);

const PackagePage = () => {
  const [activeTab, setActiveTab] = useState("readme");
  const { namespace_name, package_name } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const statuscode = useSelector((state) => state.package.statuscode);
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

  // Memoized sorted versions
  const sortedVersionsList = useMemo(() => {
    if (!data?.version_history) return [];
    return sortVersions(data.version_history);
  }, [data?.version_history]);

  if (isLoading) {
    return <PackageSkeleton />;
  }

  if (!data) {
    return (
      <Container style={{ paddingTop: 50, textAlign: 'center' }}>
        <MDBIcon fas icon="exclamation-triangle" size="3x" className="text-warning mb-3" />
        <h4>Package not found</h4>
        <p className="text-muted">The package you're looking for doesn't exist or has been removed.</p>
        <Link to="/search" className="btn btn-primary mt-3">
          Browse Packages
        </Link>
      </Container>
    );
  }

  return (
    <Container style={{ paddingTop: 25 }}>
      {/* Package Header */}
      <header className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>
            <Link
              to={`/namespaces/${data.namespace}`}
              style={{ textDecoration: "none", color: '#734f96' }}
            >
              {data.namespace}
            </Link>
            <span className="text-muted mx-1">/</span>
            <span>{data.name}</span>
          </h1>
          <p className="text-muted mb-0" style={{ fontSize: 14 }}>
            <MDBIcon fas icon="tag" className="me-1" />
            v{data.latest_version_data?.version}
            <span className="mx-2">•</span>
            <MDBIcon far icon="clock" className="me-1" />
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

      {/* Navigation Tabs */}
      <MDBTabs className="mb-3">
        <MDBTabsItem>
          <MDBTabsLink
            onClick={() => handleTabClick("readme")}
            active={activeTab === "readme"}
            type="button"
          >
            <MDBIcon fab icon="readme" className="me-2" aria-hidden="true" />
            Readme
          </MDBTabsLink>
        </MDBTabsItem>
        <MDBTabsItem>
          <MDBTabsLink
            onClick={() => handleTabClick("dependencies")}
            active={activeTab === "dependencies"}
            type="button"
          >
            <MDBIcon fas icon="boxes" className="me-2" aria-hidden="true" />
            Dependencies
          </MDBTabsLink>
        </MDBTabsItem>
        <MDBTabsItem>
          <MDBTabsLink
            onClick={() => handleTabClick("versions")}
            active={activeTab === "versions"}
            type="button"
          >
            <MDBIcon fas icon="tag" className="me-2" aria-hidden="true" />
            Versions
            {data.version_history?.length > 0 && (
              <span className="badge bg-secondary ms-2">{data.version_history.length}</span>
            )}
          </MDBTabsLink>
        </MDBTabsItem>
        <MDBTabsItem>
          <MDBTabsLink
            onClick={() => handleTabClick("stats")}
            active={activeTab === "stats"}
            type="button"
          >
            <MDBIcon fas icon="chart-bar" className="me-2" aria-hidden="true" />
            Stats
          </MDBTabsLink>
        </MDBTabsItem>
      </MDBTabs>

      {/* Tab Content */}
      <MDBTabsContent>
        <MDBTabsPane show={activeTab === "readme"}>
          <MDBContainer>
            <MDBRow>
              <MDBCol md="9" className="mb-4">
                <article className="readme-content">
                  <Markdown>{data.registry_description || '*No readme available*'}</Markdown>
                </article>
              </MDBCol>
              <PackageSidebar 
                data={data} 
                onRate={() => setShowRateForm(true)}
                onReport={() => setShowReportForm(true)}
                onCopyInstall={copyInstallCommand}
                copiedToClipboard={copiedToClipboard}
              />
            </MDBRow>
          </MDBContainer>
        </MDBTabsPane>

        <MDBTabsPane show={activeTab === "dependencies"}>
          <MDBContainer>
            <MDBRow>
              <MDBCol md="9" className="mb-4">
                <h2 style={{ fontSize: 24, textAlign: "left" }}>Dependencies</h2>
                <hr />
                <p className="text-muted">
                  <MDBIcon fas icon="info-circle" className="me-2" />
                  Dependency information is parsed from the package manifest.
                </p>
              </MDBCol>
              <PackageSidebar data={data} />
            </MDBRow>
          </MDBContainer>
        </MDBTabsPane>

        <MDBTabsPane show={activeTab === "versions"}>
          <MDBContainer>
            <MDBRow>
              <MDBCol md="9" className="mb-4">
                <h2 style={{ fontSize: 24, textAlign: "left" }}>Version History</h2>
                <hr />
                {sortedVersionsList.length > 0 ? (
                  <MDBTable hover responsive>
                    <MDBTableHead>
                      <tr>
                        <th scope="col">Version</th>
                        <th scope="col">Published</th>
                        <th scope="col">Status</th>
                        <th scope="col">Download</th>
                      </tr>
                    </MDBTableHead>
                    <MDBTableBody>
                      {sortedVersionsList.map((ver, index) => (
                        <tr key={ver.version}>
                          <td>
                            <span className={index === 0 ? 'fw-bold' : ''}>
                              v{ver.version}
                              {index === 0 && (
                                <span className="badge bg-success ms-2">Latest</span>
                              )}
                            </span>
                          </td>
                          <td>{formatTimeAgo(ver.created_at)}</td>
                          <td>
                            {ver.isDeprecated === "true" ? (
                              <span className="badge bg-warning text-dark">
                                <MDBIcon fas icon="exclamation-triangle" className="me-1" />
                                Deprecated
                              </span>
                            ) : (
                              <span className="badge bg-success">Active</span>
                            )}
                          </td>
                          <td>
                            <a
                              href={`${process.env.REACT_APP_REGISTRY_API_URL}${ver.download_url}`}
                              className="btn btn-sm btn-outline-primary"
                              download
                            >
                              <MDBIcon fas icon="download" className="me-1" />
                              Download
                            </a>
                          </td>
                        </tr>
                      ))}
                    </MDBTableBody>
                  </MDBTable>
                ) : (
                  <p className="text-muted">No version history available.</p>
                )}
              </MDBCol>
              <PackageSidebar data={data} />
            </MDBRow>
          </MDBContainer>
        </MDBTabsPane>

        <MDBTabsPane show={activeTab === "stats"}>
          <MDBContainer>
            <h2 style={{ fontSize: 24, textAlign: "left", marginBottom: 20 }}>Package Statistics</h2>
            <PackageRatingGraph data={data.ratings_count} />
          </MDBContainer>
        </MDBTabsPane>
      </MDBTabsContent>

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
      className="btn btn-outline-success"
      style={{
        padding: "8px 16px",
        borderRadius: "25px",
        fontSize: "14px",
      }}
      onClick={onShowMaintainers}
    >
      <MDBIcon fas icon="users" className="me-2" />
      View Package Maintainers
    </button>
  );
};

// Package Sidebar Component
const PackageSidebar = ({ data, onRate, onReport, onCopyInstall, copiedToClipboard }) => {
  const installCommand = `${data.name} = {'namespace'='${data.namespace}'}`;
  
  return (
    <MDBCol md="3">
      {/* Install Section */}
      <div className="mb-4">
        <h6 className="text-uppercase text-muted small mb-2">
          <MDBIcon fas icon="download" className="me-2" />
          Install
        </h6>
        <p className="small text-muted mb-1">Add to fpm.toml:</p>
        <div className="position-relative">
          <code 
            className="d-block p-2 bg-light rounded small"
            style={{ wordBreak: 'break-all' }}
          >
            {installCommand}
          </code>
          {onCopyInstall && (
            <button
              type="button"
              className="btn btn-sm btn-link position-absolute"
              style={{ top: '2px', right: '2px', padding: '2px 6px' }}
              onClick={onCopyInstall}
              aria-label="Copy install command"
            >
              <MDBIcon fas icon={copiedToClipboard ? "check" : "copy"} />
            </button>
          )}
        </div>
        {copiedToClipboard && (
          <small className="text-success">Copied to clipboard!</small>
        )}
      </div>

      <hr />

      {/* Repository */}
      {data.repository && (
        <>
          <div className="mb-3">
            <h6 className="text-uppercase text-muted small mb-2">
              <MDBIcon fas icon="code-branch" className="me-2" />
              Repository
            </h6>
            <a 
              href={data.repository}
              target="_blank"
              rel="noopener noreferrer"
              className="text-break"
            >
              {data.repository}
            </a>
          </div>
          <hr />
        </>
      )}

      {/* Homepage */}
      {data.homepage && (
        <>
          <div className="mb-3">
            <h6 className="text-uppercase text-muted small mb-2">
              <MDBIcon fas icon="home" className="me-2" />
              Homepage
            </h6>
            <a 
              href={data.homepage}
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
        <h6 className="text-uppercase text-muted small mb-2">
          <MDBIcon fas icon="balance-scale" className="me-2" />
          License
        </h6>
        <span>{data.license || 'Not specified'}</span>
      </div>

      <hr />

      {/* Version */}
      <div className="mb-3">
        <h6 className="text-uppercase text-muted small mb-2">
          <MDBIcon fas icon="tag" className="me-2" />
          Version
        </h6>
        <span>v{data.latest_version_data?.version}</span>
      </div>

      <hr />

      {/* Last Published */}
      <div className="mb-3">
        <h6 className="text-uppercase text-muted small mb-2">
          <MDBIcon far icon="calendar-alt" className="me-2" />
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
                <MDBIcon fas icon="star" className="me-1" />
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
                <MDBIcon fas icon="flag" className="me-1" />
                Report
              </Button>
            )}
          </div>
        </>
      )}
    </MDBCol>
  );
};

// Utility functions
const formatTimeAgo = (date) => {
  const updatedDate = new Date(date);
  const currentDate = new Date();
  const diffTime = currentDate.getTime() - updatedDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
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
