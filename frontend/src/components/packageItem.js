import { Row, Col, Image } from "react-bootstrap";
import { Link, useNavigate } from "react-router-dom";
import { searchPackage, setQuery } from "../store/actions/searchActions";
import { useDispatch, useSelector } from "react-redux";
import React, { useCallback } from "react";
import Icon from "./Icon";
import "./packageItem.css";

const PackageItem = ({ packageEntity }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  // D135: keep the active sort when following a keyword, same as the navbar.
  const orderBy = useSelector((state) => state.search.orderBy);

  const handleKeywordClick = useCallback(
    (keyword) => {
      dispatch(setQuery(keyword));
      dispatch(searchPackage(keyword, 0, orderBy));
      navigate("/search");
    },
    [dispatch, navigate, orderBy]
  );

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
        timeZone: "UTC",
      };
      return new Intl.DateTimeFormat("en-US", options).format(date);
    }
  };

  const keywords = packageEntity.keywords?.slice(0, 5) || [];
  const hasMoreKeywords = (packageEntity.keywords?.length || 0) > 5;

  return (
    <div className="package-item">
      <Row className="align-items-start g-3">
        <Col xs="auto">
          {/* Every package shows the same generic mark, so it is decorative:
              the package name beside it carries the meaning. */}
          <div className="package-item__mark" aria-hidden="true">
            <Image
              src={`${process.env.PUBLIC_URL}/brand/fortran-logo-256.png`}
              width={36}
              height={36}
              alt=""
              loading="lazy"
            />
          </div>
        </Col>
        <Col>
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div className="package-item__main">
              <Link
                to={`/packages/${packageEntity.namespace}/${packageEntity.name}`}
                className="text-decoration-none"
              >
                <h3 className="package-item__name">{packageEntity.name}</h3>
              </Link>
              <Link
                to={`/namespaces/${packageEntity.namespace}`}
                className="package-item__namespace"
              >
                <Icon name="folder-open" className="me-1" size={12} />
                {packageEntity.namespace}
              </Link>
            </div>
            <div className="text-end">
              <span className="package-item__meta">
                <Icon name="clock" size={12} />
                {formatDate(packageEntity.updated_at)}
              </span>
            </div>
          </div>

          <p className="package-item__description">
            {packageEntity.description || "No description available"}
          </p>

          {/* Keywords */}
          <div className="package-item__keywords">
            {keywords.map((keyword, index) => (
              <button
                key={`${packageEntity.name}-${keyword}-${index}`}
                className="package-item__keyword"
                onClick={() => handleKeywordClick(keyword)}
                type="button"
              >
                {keyword}
              </button>
            ))}
            {hasMoreKeywords && (
              <span className="package-item__more">
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
