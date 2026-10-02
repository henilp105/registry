import React, { useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Container, InputGroup, FormControl, Button } from "react-bootstrap";
import { searchPackage, setQuery } from "../store/actions/searchActions";

import "../home.css";
import Icon from "../components/Icon";

const Home = () => {
  return (
    <Container id="home-container">
      {/* Vendored in public/brand/ rather than hot-linked from
          raw.githubusercontent.com, so the hero renders with no third-party
          request and cannot break when that path moves. */}
      <div id="fpm-logo">
        <img
          src={`${process.env.PUBLIC_URL}/brand/fpm-wordmark.png`}
          alt="Fortran Package Manager"
          width={328}
          height={120}
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
  const isLoading = useSelector((state) => state.search.isLoading);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const inputRef = useRef(null);

  // Deliberately NOT autofocused (defect D66).
  //
  // This used to call `inputRef.current?.focus()` on mount, which put the caret in
  // the search box before the user had asked for anything. Three consequences:
  //
  //  - It defeated the skip link. The skip link is the first element in `App.js`
  //    and the first tab stop *by design*, but focus had already been moved past
  //    it, so the first Tab went to a suggestion chip instead. `App.js` documents
  //    this exact hazard in `useRouteChangeReset` -- "stealing it into <main>
  //    would suppress the skip link as the first tab stop" -- and then the home
  //    page suppressed it a different way.
  //  - A screen reader announced a text box rather than the page heading, so the
  //    landing page opened on a form field with no context.
  //  - On a phone it raised the on-screen keyboard over the hero before any
  //    input was intended.
  //
  // The ref is kept because it is the natural handle for this input, but nothing
  // moves focus on mount any more. The hero invites the search; it does not
  // perform it.

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
    <div className="search-container" role="search">
      <InputGroup className="search-input-group">
        <FormControl
          ref={inputRef}
          type="search"
          placeholder="Search for Fortran packages..."
          id="home-search"
          value={localQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
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
            <Icon name="search" />
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
  const links = [
    { icon: "book", label: "Documentation", path: "/help" },
    { icon: "archive", label: "Browse Archives", path: "/archives" },
    { icon: "user-plus", label: "Get Started", path: "/account/register" }
  ];

  return (
    <div className="quick-links">
      {links.map(({ icon, label, path }) => (
        // D84: these were <button onClick={navigate}>, so middle-click,
        // ctrl-click and 'copy link address' did nothing and they announced
        // as buttons rather than links.
        <Link
          key={path}
          to={path}
          className="quick-link"
        >
          <Icon name={icon} />
          <span>{label}</span>
        </Link>
      ))}
    </div>
  );
}
