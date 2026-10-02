import React, { useEffect, useState, useCallback, useRef } from "react";
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
              <UnauthenticatedNav />
            ) : (
              <AuthenticatedNav
                username={username}
                isAdmin={isAdmin}
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
const UnauthenticatedNav = () => (
  <>
    {/* Real `href`s, not `onClick` navigation on an `href="#"`.
        The Register link below already did it this way, so this is a consistency
        fix as much as a correctness one.

        An `<a href="#">` that navigates via JavaScript is announced as a link
        pointing at "#", and ctrl-click, middle-click and "open in new tab" all
        resolve to "#" instead of the destination -- so the affordance a link is
        supposed to carry is quietly removed. `as={Link}` keeps the Bootstrap
        styling and gets a genuine href. */}
    <Nav.Link as={Link} to="/archives" className="nav-link-hover">
      Archives
    </Nav.Link>
    <Nav.Link as={Link} to="/help" className="nav-link-hover">
      Help
    </Nav.Link>
    <Nav.Link as={Link} to="/account/login" className="nav-link-hover">
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

// Authenticated navigation items.
//
// The navigation items are real `<Link>`s, matching the signed-out nav beside them
// and the Register link that already did it this way. As `<NavDropdown.Item>` with
// only an `onClick`, react-bootstrap renders an `<a>` with no `href`, so the browser
// reports "link" with no destination: middle-click and ctrl-click do nothing, there
// is no status-bar preview, and "copy link address" copies nothing.
//
// The dropdown *toggle* stays a disclosure widget rather than a link, which is
// what it is: it opens a menu, it does not go anywhere.
//
// Logout is deliberately left as an `onClick` item. It is an action, not a
// destination, so a button is the honest element -- giving it an href would imply
// there is a page to open in a new tab.
const AuthenticatedNav = ({ username, isAdmin, onSignOut }) => (
  <NavDropdown
    title={<span className="fw-medium">{username}</span>}
    id="user-nav-dropdown"
    align="end"
  >
    <NavDropdown.Item as={Link} to="/namespace/create">
      <Icon name="plus-circle" className="me-2" /> Create Namespace
    </NavDropdown.Item>
    <NavDropdown.Item as={Link} to="/manage/projects">
      <Icon name="th-large" className="me-2" /> Dashboard
    </NavDropdown.Item>
    <NavDropdown.Item as={Link} to="/manage/account">
      <Icon name="user-cog" className="me-2" /> Account
    </NavDropdown.Item>

    {isAdmin && (
      <NavDropdown.Item as={Link} to="/admin">
        <Icon name="shield-alt" className="me-2" /> Admin
      </NavDropdown.Item>
    )}

    <NavDropdown.Divider />

    <NavDropdown.Item as={Link} to="/help">
      <Icon name="question-circle" className="me-2" /> Help
    </NavDropdown.Item>
    <NavDropdown.Item as={Link} to="/archives">
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

  // Debounce search input
  const debouncedQuery = useDebounce(localQuery, 300);

  /**
   * Whether the current value in the box was typed by the user, rather than
   * mirrored down from redux.
   *
   * The navbar's type-ahead fires when the debounced value changes. Without this
   * flag, every search ran **twice**:
   *
   *   1. The user searches from the home page or presses Enter -> one request,
   *      and the route changes to /search.
   *   2. That dispatch updates `state.search.query`, the sync effect below copies
   *      it into `localQuery`, the debounce fires 300 ms later, the pathname is
   *      now `/search`, and the type-ahead effect issues the *same* search again.
   *
   * Measured on a production build, for all three entry points -- the home field,
   * the navbar field and a suggestion chip -- every one produced exactly two
   * identical requests to `/packages?query=…`.
   *
   * It matters more than a cosmetic duplicate: `/packages` is the hottest read in
   * the system, the whole architecture is built to protect a 100 ops/second Atlas
   * cap and a 100,000 requests/day Worker budget, and this doubled the load on
   * precisely the route those budgets were sized around. The two responses also
   * race 300 ms apart, so results can visibly flicker.
   *
   * So type-ahead still works for real typing, but a value that arrived *from*
   * redux does not re-trigger it. The user did not ask for that search twice.
   */
  const typedByUser = useRef(false);

  // Sync local state with redux state.
  useEffect(() => {
    typedByUser.current = false;
    setLocalQuery(query);
  }, [query]);

  // Auto-search when the debounced value changes, but only for user input, and
  // only while already on the search page.
  useEffect(() => {
    if (!typedByUser.current) return;
    typedByUser.current = false;
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
      typedByUser.current = false;
      setLocalQuery("");
      // The store keeps the old term otherwise, so navigating away and back
      // shows the stale query in the box while /search still shows old
      // results under an empty-looking input (D84).
      dispatch(setQuery(""));
    }
  };

  const handleInputChange = (event) => {
    typedByUser.current = true;
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
