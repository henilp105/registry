import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Container, InputGroup, FormControl, Button } from "react-bootstrap";
import { searchPackage, setQuery } from "../store/actions/searchActions";

import "../home.css";

const Home = () => {
  return (
    <Container id="home-container">
      <div id="fpm-logo">
        <img 
          src="https://raw.githubusercontent.com/fortran-lang/assets/main/fpm/logo/2-color-alt/png/full-color-alt.png" 
          alt="Fortran Package Manager Logo" 
          loading="lazy"
        />
      </div>

      <HomeSearchField />
      
      <p id="fpm-subscript">The official registry for fpm packages</p>
      
      <QuickLinks />
    </Container>
  );
};

export default Home;

function HomeSearchField() {
  const [localQuery, setLocalQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const isLoading = useSelector((state) => state.search.isLoading);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Focus the search input on mount
  useEffect(() => {
    const searchInput = document.getElementById("home-search");
    if (searchInput) {
      // Slight delay to ensure smooth page load
      setTimeout(() => searchInput.focus(), 100);
    }
  }, []);

  const handleSearch = useCallback(() => {
    const trimmedQuery = localQuery.trim();
    if (trimmedQuery) {
      dispatch(setQuery(trimmedQuery));
      dispatch(searchPackage(trimmedQuery, 0));
      navigate("/search");
    }
  }, [localQuery, dispatch, navigate]);

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  };

  const handleInputChange = (event) => {
    setLocalQuery(event.target.value);
  };

  return (
    <div 
      className={`search-container ${isFocused ? 'search-focused' : ''}`}
      role="search"
    >
      <InputGroup className="search-input-group">
        <FormControl
          type="search"
          placeholder="Search for Fortran packages..."
          id="home-search"
          value={localQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          aria-label="Search packages"
          autoComplete="off"
        />
        <Button 
          variant="primary"
          onClick={handleSearch}
          disabled={isLoading || !localQuery.trim()}
          className="search-button"
          aria-label="Submit search"
        >
          {isLoading ? (
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
          ) : (
            <i className="fas fa-search" aria-hidden="true" />
          )}
        </Button>
      </InputGroup>
      
      {/* Search hints */}
      <div className="search-hints">
        <span>Try: </span>
        <SearchSuggestion query="json" />
        <SearchSuggestion query="testing" />
        <SearchSuggestion query="math" />
        <SearchSuggestion query="io" />
      </div>
    </div>
  );
}

// Quick search suggestion chips
function SearchSuggestion({ query }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleClick = () => {
    dispatch(setQuery(query));
    dispatch(searchPackage(query, 0));
    navigate("/search");
  };

  return (
    <button 
      className="search-suggestion"
      onClick={handleClick}
      type="button"
    >
      {query}
    </button>
  );
}

// Quick links section
function QuickLinks() {
  const navigate = useNavigate();

  const links = [
    { icon: "fa-book", label: "Documentation", path: "/help" },
    { icon: "fa-archive", label: "Browse Archives", path: "/archives" },
    { icon: "fa-user-plus", label: "Get Started", path: "/account/register" }
  ];

  return (
    <div className="quick-links">
      {links.map(({ icon, label, path }) => (
        <button
          key={path}
          className="quick-link"
          onClick={() => navigate(path)}
          type="button"
        >
          <i className={`fas ${icon}`} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
