import { MDBListGroupItem } from "mdb-react-ui-kit";
import { Row, Col, Image } from "react-bootstrap";
import { Link } from "react-router-dom";
import { searchPackage, setQuery } from "../store/actions/searchActions";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

const PackageItem = ({ packageEntity }) => {
  const dispatch = useDispatch();
  const query = useSelector((state) => state.search.query);
  const navigate = useNavigate();
  const search = () => {
    if (query.trim().length !== 0) {
      dispatch(searchPackage(query, 0));
      navigate("/search");
    }
  };

function formatDate(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);

  if (isNaN(date.getTime())) {
    return "Invalid date";
  }

  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // Less than 12 hours (43,200 seconds)
  if (diffSeconds < 43200) {
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 1) {
      return "Just now";
    } else if (minutes < 60) {
      return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    } else {
      const hours = Math.floor(minutes / 60);
      return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
    }
  } else {
    // Format as: "March 30, 2024"
    const options = {
      year: "numeric",
      month: "long",
      day: "2-digit",
      timeZone: "UTC"
    };
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }
}

  const spanStyle = {
    borderRadius: "5px",
    backgroundColor: "lavender",
    padding: "3px 8px",
    margin: "2px",
    textDecoration: "none",
    color: "grey",
  };

  return (
    <MDBListGroupItem id="list-item">
      <Row style={{}}>
        <Col md={1}>
          <Image
            src="https://fortran-lang.org/_static/fortran-logo-256x256.png"
            fluid
            width={60}
            height={60}
          />
        </Col>
        <Col md={6} style={{ padding: "10px" }}>
          <Link
            to={`/packages/${packageEntity.namespace}/${packageEntity.name}`}
            style={{
              textDecoration: "none",
              color: "black",
            }}
          >
            <h5 id="list-item-package-name" style={{ color: "black" }}>
              {packageEntity.name}
            </h5>
          </Link>
          <h6 className="mb-4 text-muted">
            <Link
              to={`/namespaces/${packageEntity.namespace}`}
              style={{
                textDecoration: "none",
                color: "grey",
              }}
            >
              Namespace {packageEntity.namespace}
            </Link>
          </h6>
          <label className="mb-4 text-muted" style={{ fontSize: "18px" }}>
            {packageEntity.description}
          </label>
        </Col>
        <Col md={1} style={{ flex: 1, textAlign: "right" }}>
          <label style={{ fontSize: "16px" }}>
            Last released {formatDate(packageEntity.updated_at)}
          </label>
        </Col>
      </Row>
      {packageEntity.keywords.map((keyword, index) => (
        <a
          key={index}
          style={spanStyle}
          onClick={() => {
            dispatch(setQuery(keyword));
            search();
          }}
        >
          {keyword}
        </a>
      ))}
    </MDBListGroupItem>
  );
};

export default PackageItem;
