import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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
    <Navbar bg="light" expand="md" sticky="top" className="shadow-sm">
      <Container id="navbar-container">
        <Navbar.Brand
          onClick={() => handleNavigation("/")}
          style={{ cursor: "pointer" }}
          role="button"
          aria-label="Go to homepage"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleNavigation("/")}
        >
          <Image
            src="https://fortran-lang.org/_static/fortran-logo-256x256.png"
            fluid
            width={60}
            height={60}
            alt="FPM Registry - Fortran Package Manager"
          />
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="responsive-navbar-nav" aria-label="Toggle navigation" />
        <Navbar.Collapse id="responsive-navbar-nav">
          {location.pathname !== "/" && <SearchBar />}
          
          <Nav className="ms-auto align-items-center">
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
      onClick={() => onNavigate("/account/register")} 
      className="btn btn-primary text-white ms-2 px-3"
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
      <i className="fas fa-plus-circle me-2" /> Create Namespace
    </NavDropdown.Item>
    <NavDropdown.Item onClick={() => onNavigate("/manage/projects")}>
      <i className="fas fa-th-large me-2" /> Dashboard
    </NavDropdown.Item>
    <NavDropdown.Item onClick={() => onNavigate("/manage/account")}>
      <i className="fas fa-user-cog me-2" /> Account
    </NavDropdown.Item>
    
    {isAdmin && (
      <NavDropdown.Item onClick={() => onNavigate("/admin")}>
        <i className="fas fa-shield-alt me-2" /> Admin
      </NavDropdown.Item>
    )}
    
    <NavDropdown.Divider />
    
    <NavDropdown.Item onClick={() => onNavigate("/help")}>
      <i className="fas fa-question-circle me-2" /> Help
    </NavDropdown.Item>
    <NavDropdown.Item onClick={() => onNavigate("/archives")}>
      <i className="fas fa-archive me-2" /> Archives
    </NavDropdown.Item>
    
    <NavDropdown.Divider />
    
    <NavDropdown.Item onClick={onSignOut} className="text-danger">
      <i className="fas fa-sign-out-alt me-2" /> Logout
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
      <div className="input-group" style={{ maxWidth: "500px" }}>
        <input
          type="search"
          className="form-control"
          placeholder="Search packages..."
          value={localQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          aria-label="Search packages"
          style={{ borderRadius: "50px 0 0 50px" }}
        />
        <button 
          className="btn btn-primary" 
          onClick={handleSearch}
          disabled={isLoading || !localQuery.trim()}
          aria-label="Submit search"
          style={{ borderRadius: "0 50px 50px 0" }}
        >
          {isLoading ? (
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
          ) : (
            <i className="fas fa-search" />
          )}
        </button>
      </div>
    </div>
  );
};

export default NavbarComponent;
