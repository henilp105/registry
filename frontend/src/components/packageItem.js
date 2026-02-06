import { Row, Col, Image } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import { searchPackage, setQuery } from "../store/actions/searchActions";
import { useDispatch } from "react-redux";
import React, { useCallback, useState } from "react";

const PackageItem = ({ packageEntity }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);

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

  const cardStyle = {
    background: "#ffffff",
    borderRadius: "12px",
    padding: "1.25rem",
    border: "1px solid #e5e7eb",
    transition: "all 0.2s ease",
    boxShadow: isHovered 
      ? "0 8px 25px rgba(99, 102, 241, 0.15)" 
      : "0 2px 8px rgba(0, 0, 0, 0.04)",
    transform: isHovered ? "translateY(-2px)" : "translateY(0)",
    borderColor: isHovered ? "#c7d2fe" : "#e5e7eb"
  };

  const keywordStyle = {
    borderRadius: "16px",
    backgroundColor: "#f3f4f6",
    padding: "4px 12px",
    margin: "2px",
    textDecoration: "none",
    color: "#4b5563",
    fontSize: "12px",
    cursor: "pointer",
    display: "inline-block",
    transition: "all 0.2s ease",
    border: "1px solid #e5e7eb",
    fontWeight: "500"
  };

  const keywords = packageEntity.keywords?.slice(0, 5) || [];
  const hasMoreKeywords = (packageEntity.keywords?.length || 0) > 5;

  return (
    <div 
      style={cardStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Row className="align-items-start g-3">
        <Col xs="auto">
          <div style={{
            width: "48px",
            height: "48px",
            borderRadius: "10px",
            overflow: "hidden",
            backgroundColor: "#f0f4ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <Image
              src="https://fortran-lang.org/_static/fortran-logo-256x256.png"
              width={36}
              height={36}
              alt=""
              loading="lazy"
            />
          </div>
        </Col>
        <Col>
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div style={{ flex: 1, minWidth: "200px" }}>
              <Link
                to={`/packages/${packageEntity.namespace}/${packageEntity.name}`}
                className="text-decoration-none"
              >
                <h5 
                  className="mb-1 fw-bold"
                  style={{ 
                    fontSize: "1.1rem",
                    color: "#6366f1",
                    transition: "color 0.2s ease"
                  }}
                >
                  {packageEntity.name}
                </h5>
              </Link>
              <Link
                to={`/namespaces/${packageEntity.namespace}`}
                className="text-decoration-none"
                style={{ color: "#9ca3af", fontSize: "0.85rem" }}
              >
                <i className="fas fa-folder-open me-1" style={{ fontSize: "0.75rem" }} />
                {packageEntity.namespace}
              </Link>
            </div>
            <div className="text-end" style={{ flexShrink: 0 }}>
              <span style={{ 
                color: "#9ca3af", 
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "4px"
              }}>
                <i className="fas fa-clock" style={{ fontSize: "0.75rem" }} />
                {formatDate(packageEntity.updated_at)}
              </span>
            </div>
          </div>
          
          <p 
            className="mb-2 mt-2" 
            style={{ 
              fontSize: "0.9rem",
              lineHeight: "1.6",
              color: "#6b7280",
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
          <div className="d-flex flex-wrap gap-1 mt-3">
            {keywords.map((keyword, index) => (
              <button
                key={index}
                style={keywordStyle}
                onClick={() => handleKeywordClick(keyword)}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = "#e0e7ff";
                  e.target.style.borderColor = "#a5b4fc";
                  e.target.style.color = "#4f46e5";
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = "#f3f4f6";
                  e.target.style.borderColor = "#e5e7eb";
                  e.target.style.color = "#4b5563";
                }}
                type="button"
                aria-label={`Search for ${keyword}`}
              >
                {keyword}
              </button>
            ))}
            {hasMoreKeywords && (
              <span 
                className="align-self-center"
                style={{ fontSize: "11px", color: "#9ca3af", fontWeight: "500" }}
              >
                +{packageEntity.keywords.length - 5} more
              </span>
            )}
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default PackageItem;
