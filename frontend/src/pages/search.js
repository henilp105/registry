import React, { useEffect, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import PackageItem from "../components/packageItem";
import { SkeletonPackageList } from "../components/SkeletonLoader";
import Pagination from "../components/pagination";
import Dropdown from "react-bootstrap/Dropdown";
import DropdownButton from "react-bootstrap/DropdownButton";
import Alert from "react-bootstrap/Alert";
import { searchPackage, setOrderBy } from "../store/actions/searchActions";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import "./search.css";

const dropdownOptions = [
  { value: "None", label: "Relevance" },
  { value: "Date last updated", label: "Recently Updated" },
  { value: "name", label: "Name (A-Z)" },
  { value: "downloads", label: "Most Downloads" },
];

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

  const onDropDownSelect = useCallback(
    (option) => {
      dispatch(setOrderBy(option));
      dispatch(searchPackage(query, 0, option));
    },
    [dispatch, query]
  );

  useEffect(() => {
    if (query.length === 0 && !isLoading) {
      navigate("/");
    }
  }, [query, isLoading, navigate]);

  // Show skeleton loader while loading
  if (isLoading) {
    return (
      <div className="search-page">
        <p className="search-page__status">
          Searching for &ldquo;<strong>{query}</strong>&rdquo;&hellip;
        </p>
        <SkeletonPackageList count={5} />
      </div>
    );
  }

  // Show error state
  if (error !== null) {
    return (
      <div className="search-page">
        {/* role="alert" so a failed search is announced rather than silently
            replacing the previous results. */}
        <Alert variant="danger" className="d-flex align-items-center" role="alert">
          <Icon name="exclamation-triangle" className="me-2" />
          {error}
        </Alert>
      </div>
    );
  }

  // Show empty state
  if (packages !== null && packages.length === 0) {
    return (
      <div className="search-page">
        <EmptySearchState query={query} />
      </div>
    );
  }

  // Show results. The count is a live region: it changes as the user pages and
  // re-sorts, and without that the only feedback is a visual rearrangement.
  if (packages !== null) {
    return (
      <div className="search-page">
        <div className="search-page__controls">
          <p className="search-page__status" aria-live="polite">
            Found <strong>{packages.length}</strong> package
            {packages.length !== 1 ? "s" : ""} for &ldquo;
            <strong>{query}</strong>&rdquo;
          </p>
          <div className="d-flex align-items-center gap-2">
            <label htmlFor="sort-dropdown" className="search-page__sort">
              Sort by:
            </label>
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
  <div className="search-empty">
    <Icon name="search" size={48} className="search-empty__icon" />
    <h1 className="search-empty__title">No packages found</h1>
    <p className="search-empty__body">
      We couldn&rsquo;t find any packages matching &ldquo;
      <strong>{query}</strong>&rdquo;
    </p>
    <div className="search-empty__tips">
      <h2 className="search-empty__tips-title">Search tips</h2>
      <ul className="search-empty__tips-list">
        <li>Check your spelling</li>
        <li>Try more general keywords</li>
        <li>Try different keywords</li>
        <li>Search by package name, description, or keywords</li>
      </ul>
    </div>
  </div>
);

// Package list with a short staggered entrance
const ListView = ({ packages, currentPage, totalPages }) => (
  <div className="search-results">
    {packages.map((packageEntity, index) => (
      <div
        key={`${packageEntity.namespace}/${packageEntity.name}`}
        className="search-results__item"
        style={{ "--index": index }}
      >
        <PackageItem packageEntity={packageEntity} />
      </div>
    ))}
    <div className="search-pagination">
      <Pagination currentPage={currentPage} totalPages={totalPages} />
    </div>
  </div>
);

// Dropdown sort component
const DropdownSortBy = ({ orderBy, dropdownOptions, onDropDownSelect }) => {
  const currentOption =
    dropdownOptions.find((opt) => opt.value === orderBy) || dropdownOptions[0];

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
