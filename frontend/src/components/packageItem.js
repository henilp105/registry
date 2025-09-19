import { MDBListGroupItem } from "mdb-react-ui-kit";
import { Row, Col, Image } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import { searchPackage, setQuery } from "../store/actions/searchActions";
import { useDispatch } from "react-redux";
import React, { useCallback } from "react";

const PackageItem = ({ packageEntity }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleKeywordClick = useCallback((keyword) => {
    dispatch(setQuery(keyword));
    dispatch(searchPackage(keyword, 0));
    navigate("/search");
  }, [dispatch, navigate]);

  const formatDate = (timestamp) => {
    const now = new Date();
    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
      return "Unknown";
    }

    const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSeconds < 60) {
      return "Just now";
    } else if (diffSeconds < 3600) {
      const minutes = Math.floor(diffSeconds / 60);
      return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    } else if (diffSeconds < 43200) {
      const hours = Math.floor(diffSeconds / 3600);
      return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
    } else if (diffSeconds < 86400) {
      return "Today";
    } else if (diffSeconds < 172800) {
      return "Yesterday";
    } else if (diffSeconds < 604800) {
      const days = Math.floor(diffSeconds / 86400);
      return `${days} days ago`;
    } else {
      const options = {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC"
      };
      return new Intl.DateTimeFormat("en-US", options).format(date);
    }
  };

  const keywordStyle = {
    borderRadius: "12px",
    backgroundColor: "#f0f4f8",
    padding: "4px 10px",
    margin: "2px",
    textDecoration: "none",
    color: "#555",
    fontSize: "12px",
    cursor: "pointer",
    display: "inline-block",
    transition: "all 0.2s ease",
    border: "1px solid transparent"
  };

  const keywords = packageEntity.keywords?.slice(0, 5) || [];
  const hasMoreKeywords = (packageEntity.keywords?.length || 0) > 5;

  return (
    <MDBListGroupItem 
      id="list-item"
      className="py-3"
      style={{ borderRadius: "8px", marginBottom: "0.5rem" }}
    >
      <Row className="align-items-start">
        <Col xs={2} md={1} className="d-flex justify-content-center">
          <Image
            src="https://fortran-lang.org/_static/fortran-logo-256x256.png"
            fluid
            width={50}
            height={50}
            alt=""
            loading="lazy"
            style={{ minWidth: "40px" }}
          />
        </Col>
        <Col xs={10} md={7} className="ps-2">
          <Link
            to={`/packages/${packageEntity.namespace}/${packageEntity.name}`}
            className="text-decoration-none"
          >
            <h5 
              id="list-item-package-name" 
              className="mb-1 fw-semibold"
              style={{ fontSize: "1.1rem" }}
            >
              {packageEntity.name}
            </h5>
          </Link>
          <Link
            to={`/namespaces/${packageEntity.namespace}`}
            className="text-decoration-none text-muted small"
          >
            <i className="fas fa-folder-open me-1" style={{ fontSize: "0.8rem" }} />
            {packageEntity.namespace}
          </Link>
          <p 
            className="text-muted mt-2 mb-2" 
            style={{ 
              fontSize: "0.9rem",
              lineHeight: "1.5",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical"
            }}
          >
            {packageEntity.description || "No description available"}
          </p>
          
          {/* Keywords */}
          <div className="d-flex flex-wrap gap-1 mt-2">
            {keywords.map((keyword, index) => (
              <button
                key={index}
                style={keywordStyle}
                onClick={() => handleKeywordClick(keyword)}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = "#e0e8f0";
                  e.target.style.borderColor = "#3d94f6";
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = "#f0f4f8";
                  e.target.style.borderColor = "transparent";
                }}
                type="button"
                aria-label={`Search for ${keyword}`}
              >
                {keyword}
              </button>
            ))}
            {hasMoreKeywords && (
              <span 
                className="text-muted small align-self-center"
                style={{ fontSize: "11px" }}
              >
                +{packageEntity.keywords.length - 5} more
              </span>
            )}
          </div>
        </Col>
        <Col xs={12} md={4} className="text-md-end mt-2 mt-md-0">
          <div className="d-flex flex-column align-items-md-end">
            <span className="text-muted small">
              <i className="fas fa-clock me-1" />
              {formatDate(packageEntity.updated_at)}
            </span>
          </div>
        </Col>
      </Row>
    </MDBListGroupItem>
  );
};

export default PackageItem;
