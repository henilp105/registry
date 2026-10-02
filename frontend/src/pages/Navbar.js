import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import Image from "react-bootstrap/Image";
import Container from "react-bootstrap/Container";
import Nav from "react-bootstrap/Nav";
import Navbar from "react-bootstrap/Navbar";
import NavDropdown from "react-bootstrap/NavDropdown";
import { logout } from "../store/actions/authActions";
import { searchPackage, setQuery } from "../store/actions/searchActions";
import { adminAuth } from "../store/actions/adminActions";
import { useDebounce } from "../hooks/useDebounce";
import ThemeToggle from "../theme/ThemeToggle";
import Icon from "../components/Icon";

const NavbarComponent = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const location = useLocation();
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  const isAdmin = useSelector((state) => state.admin.isAdmin);
  const username = useSelector((state) => state.auth.username);
  const accessToken = useSelector((state) => state.auth.accessToken);

  useEffect(() => {
    if (isAuthenticated && accessToken) {
      dispatch(adminAuth(accessToken));
    }
  }, [isAuthenticated, accessToken, dispatch]);

  const signOut = useCallback(() => {
    dispatch(logout(accessToken));
    navigate("/");
  }, [dispatch, accessToken, navigate]);

  const handleNavigation = useCallback((path) => {
    navigate(path);
  }, [navigate]);

  return (
    <Navbar expand="md" sticky="top" className="app-navbar">
      <Container id="navbar-container">
        {/*
          Rendered as a real link, not a clickable <div>: it gives us correct
          middle-click, open-in-new-tab and screen-reader behaviour for free.
          The mark is vendored in public/brand/ rather than hot-linked from
          fortran-lang.org, so the shell renders with no third-party request.
        */}
        <Navbar.Brand as={Link} to="/" className="d-flex align-items-center gap-2">
          <Image
            src={`${process.env.PUBLIC_URL}/brand/fortran-logo-256.png`}
            width={36}
            height={36}
            alt=""
            aria-hidden="true"
          />
          <span className="app-navbar__wordmark">
            fpm <span className="app-navbar__wordmark-accent">registry</span>
          </span>
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="responsive-navbar-nav" aria-label="Toggle navigation" />
        <Navbar.Collapse id="responsive-navbar-nav">
          {location.pathname !== "/" && <SearchBar />}

          <Nav className="ms-auto align-items-center gap-lg-1">
            {!isAuthenticated ? (
              <UnauthenticatedNav onNavigate={handleNavigation} />
            ) : (
              <AuthenticatedNav
                username={username}
                isAdmin={isAdmin}
                onNavigate={handleNavigation}
                onSignOut={signOut}
              />
            )}
            <ThemeToggle />
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

// Unauthenticated navigation items
const UnauthenticatedNav = ({ onNavigate }) => (
  <>
    <Nav.Link onClick={() => onNavigate("/archives")} className="nav-link-hover">
      Archives
    </Nav.Link>
    <Nav.Link onClick={() => onNavigate("/help")} className="nav-link-hover">
      Help
    </Nav.Link>
    <Nav.Link onClick={() => onNavigate("/account/login")} className="nav-link-hover">
      Login
    </Nav.Link>
    <Nav.Link
      as={Link}
      to="/account/register"
      className="ms-2 px-3 nav-cta btn btn-primary btn-sm"
    >
      Register
    </Nav.Link>
  </>
);

// Authenticated navigation items
const AuthenticatedNav = ({ username, isAdmin, onNavigate, onSignOut }) => (
  <NavDropdown 
    title={<span className="fw-medium">{username}</span>} 
    id="user-nav-dropdown"
    align="end"
  >
    <NavDropdown.Item onClick={() => onNavigate("/namespace/create")}>
      <Icon name="plus-circle" className="me-2" /> Create Namespace
    </NavDropdown.Item>
    <NavDropdown.Item onClick={() => onNavigate("/manage/projects")}>
      <Icon name="th-large" className="me-2" /> Dashboard
    </NavDropdown.Item>
    <NavDropdown.Item onClick={() => onNavigate("/manage/account")}>
      <Icon name="user-cog" className="me-2" /> Account
    </NavDropdown.Item>
    
    {isAdmin && (
      <NavDropdown.Item onClick={() => onNavigate("/admin")}>
        <Icon name="shield-alt" className="me-2" /> Admin
      </NavDropdown.Item>
    )}
    
    <NavDropdown.Divider />
    
    <NavDropdown.Item onClick={() => onNavigate("/help")}>
      <Icon name="question-circle" className="me-2" /> Help
    </NavDropdown.Item>
    <NavDropdown.Item onClick={() => onNavigate("/archives")}>
      <Icon name="archive" className="me-2" /> Archives
    </NavDropdown.Item>
    
    <NavDropdown.Divider />
    
    <NavDropdown.Item onClick={onSignOut} className="text-danger">
      <Icon name="sign-out-alt" className="me-2" /> Logout
    </NavDropdown.Item>
  </NavDropdown>
);

// Search bar component with debouncing
const SearchBar = () => {
  const [localQuery, setLocalQuery] = useState("");
  const query = useSelector((state) => state.search.query);
  const isLoading = useSelector((state) => state.search.isLoading);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Sync local state with redux state
  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  // Debounce search input
  const debouncedQuery = useDebounce(localQuery, 300);

  // Auto-search when debounced value changes (only if on search page)
  useEffect(() => {
    if (debouncedQuery.trim() && window.location.pathname === "/search") {
      dispatch(setQuery(debouncedQuery));
      dispatch(searchPackage(debouncedQuery, 0));
    }
  }, [debouncedQuery, dispatch]);

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
    // Clear search on Escape
    if (event.key === "Escape") {
      setLocalQuery("");
    }
  };

  const handleInputChange = (event) => {
    setLocalQuery(event.target.value);
  };

  return (
    <div className="d-flex flex-grow-1 mx-3" id="search-bar">
      {/* The pill radius and the max width are in App.css (#search-bar);
          the input and button each get one half so there is no seam. */}
      <div className="input-group">
        <input
          type="search"
          className="form-control"
          placeholder="Search packages..."
          value={localQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          aria-label="Search packages"
        />
        <button
          className="btn btn-primary"
          onClick={handleSearch}
          disabled={isLoading || !localQuery.trim()}
          aria-label="Submit search"
        >
          {isLoading ? (
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
          ) : (
            <Icon name="search" />
          )}
        </button>
      </div>
    </div>
  );
};

export default NavbarComponent;
