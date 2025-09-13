import React, { useEffect, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import PackageItem from "../components/packageItem";
import { SkeletonPackageList } from "../components/SkeletonLoader";
import { MDBListGroup } from "mdbreact";
import Pagination from "../components/pagination";
import Dropdown from "react-bootstrap/Dropdown";
import DropdownButton from "react-bootstrap/DropdownButton";
import Alert from "react-bootstrap/Alert";
import { searchPackage, setOrderBy } from "../store/actions/searchActions";
import { useNavigate } from "react-router-dom";

const Search = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const packages = useSelector((state) => state.search.packages);
  const error = useSelector((state) => state.search.error);
  const totalPages = useSelector((state) => state.search.totalPages);
  const currentPage = useSelector((state) => state.search.currentPage);
  const orderBy = useSelector((state) => state.search.orderBy);
  const query = useSelector((state) => state.search.query);
  const isLoading = useSelector((state) => state.search.isLoading);

  const dropdownOptions = [
    { value: "None", label: "Relevance" },
    { value: "Date last updated", label: "Recently Updated" },
    { value: "name", label: "Name (A-Z)" },
    { value: "downloads", label: "Most Downloads" }
  ];

  const onDropDownSelect = useCallback((option) => {
    dispatch(setOrderBy(option));
    dispatch(searchPackage(query, 0, option));
  }, [dispatch, query]);

  useEffect(() => {
    if (query.length === 0 && !isLoading) {
      navigate("/");
    }
  }, [query, isLoading, navigate]);

  // Show skeleton loader while loading
  if (isLoading) {
    return (
      <div className="container" style={{ paddingTop: "1rem" }}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <p className="text-muted mb-0">
            Searching for "<strong>{query}</strong>"...
          </p>
        </div>
        <SkeletonPackageList count={5} />
      </div>
    );
  }

  // Show error state
  if (error !== null) {
    return (
      <div className="container" style={{ paddingTop: "1rem" }}>
        <Alert variant="danger" className="d-flex align-items-center">
          <i className="fas fa-exclamation-triangle me-2" />
          {error}
        </Alert>
      </div>
    );
  }

  // Show empty state
  if (packages !== null && packages.length === 0) {
    return (
      <div className="container" style={{ paddingTop: "1rem" }}>
        <EmptySearchState query={query} />
      </div>
    );
  }

  // Show results
  if (packages !== null) {
    return (
      <div className="container" style={{ paddingTop: "1rem" }}>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <p className="text-muted mb-0">
            Found <strong>{packages.length}</strong> package{packages.length !== 1 ? 's' : ''} for "<strong>{query}</strong>"
          </p>
          <div className="d-flex align-items-center gap-2">
            <label htmlFor="sort-dropdown" className="text-muted mb-0 small">Sort by:</label>
            <DropdownSortBy
              orderBy={orderBy}
              dropdownOptions={dropdownOptions}
              onDropDownSelect={onDropDownSelect}
            />
          </div>
        </div>
        <ListView
          packages={packages}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      </div>
    );
  }

  return null;
};

export default Search;

// Empty search state with suggestions
const EmptySearchState = ({ query }) => (
  <div 
    className="text-center py-5"
    role="status"
    aria-live="polite"
  >
    <div className="mb-4">
      <i className="fas fa-search fa-3x text-muted" />
    </div>
    <h4 className="mb-3">No packages found</h4>
    <p className="text-muted mb-4">
      We couldn't find any packages matching "<strong>{query}</strong>"
    </p>
    <div className="bg-light rounded p-4 mx-auto" style={{ maxWidth: "500px" }}>
      <h6 className="mb-3">Search tips:</h6>
      <ul className="text-start text-muted mb-0">
        <li>Check your spelling</li>
        <li>Try more general keywords</li>
        <li>Try different keywords</li>
        <li>Search by package name, description, or keywords</li>
      </ul>
    </div>
  </div>
);

// Package list with animation
const ListView = ({ packages, currentPage, totalPages }) => {
  return (
    <MDBListGroup style={{ alignItems: "center" }}>
      {packages.map((packageEntity, index) => (
        <div 
          key={packageEntity.name + packageEntity.namespace}
          style={{
            animation: `fadeIn 0.3s ease-out ${index * 0.05}s both`,
            width: "100%"
          }}
        >
          <PackageItem packageEntity={packageEntity} />
        </div>
      ))}
      <div className="mt-4">
        <Pagination currentPage={currentPage} totalPages={totalPages} />
      </div>
    </MDBListGroup>
  );
};

// Dropdown sort component
const DropdownSortBy = ({ orderBy, dropdownOptions, onDropDownSelect }) => {
  const currentOption = dropdownOptions.find(opt => opt.value === orderBy) || dropdownOptions[0];
  
  return (
    <DropdownButton 
      id="sort-dropdown"
      title={currentOption.label}
      variant="outline-secondary"
      size="sm"
    >
      {dropdownOptions.map((option) => (
        <Dropdown.Item 
          key={option.value} 
          onClick={() => onDropDownSelect(option.value)}
          active={orderBy === option.value}
        >
          {option.label}
        </Dropdown.Item>
      ))}
    </DropdownButton>
  );
};
