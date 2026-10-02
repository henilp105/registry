import React from "react";
import "./App.css";
import NavbarComponent from "./pages/Navbar";
import Login from "./pages/login";
import Help from "./pages/help";
import Register from "./pages/register";
import Home from "./pages/home";
import Dashboard from "./pages/dashboard";
import Account from "./pages/account";
import Search from "./pages/search";
import NoPage from "./pages/404";
import UserPage from "./pages/user";
import PackagePage from "./pages/package";
import NamespaceForm from "./pages/createNamespace";
import VerifyEmail from "./pages/verifyEmail";
import NamespacePage from "./pages/namespace";
import AdminSection from "./pages/admin";
import Archives from "./pages/archives";
import ForgotPassword from "./pages/forgotpassword";
import ResetPassword from "./pages/resetpassword";
import SessionGuard from "./components/SessionGuard";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import Container from "react-bootstrap/Container";

// Bootstrap is imported once, in src/index.js, in the position the cascade
// needs. Importing it here as well would load it *after* theme/base.css and
// let the vendor sheet win the tie against the token layer.

/**
 * Restores scroll and focus after a client-side navigation.
 *
 * Two separate problems, one hook:
 *
 * 1. Scroll. react-router does not reset scroll between routes, so scrolling
 *    halfway down the archives list and clicking a package leaves you
 *    halfway down the package page - often past the content you wanted.
 * 2. Focus. On a route change the browser leaves focus on the link you
 *    clicked, so the next Tab continues from the navbar rather than from the
 *    top of the new page, and a screen reader does not announce the new page.
 *    Moving focus to the main landmark fixes both.
 *
 * The initial mount is skipped on purpose: on a fresh load the browser has
 * already put focus at the top of the document, and stealing it into <main>
 * would suppress the skip link as the first tab stop.
 */
const useRouteChangeReset = () => {
  const { pathname } = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    const main = document.getElementById("main-content");
    if (main) {
      // preventScroll so this does not fight the scrollTo above.
      main.focus({ preventScroll: true });
    }
  }, [pathname]);
};

/** Mounts useRouteChangeReset. Needs to be inside <BrowserRouter>. */
const RouteChangeReset = () => {
  useRouteChangeReset();
  return null;
};

function App() {
  return (
    <BrowserRouter>
      <SessionGuard />
      <RouteChangeReset />
      {/* First tab stop on every page. */}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <NavbarComponent />
      {/*
        One <main> for the whole app, here, rather than one per page. It is
        the skip-link target and the post-navigation focus target, and having a
        single definition means no page can forget it. Pages that previously
        rendered their own <main> now render a <div>; nested <main> elements
        are invalid and screen readers announce the landmark twice.
      */}
      <main id="main-content" tabIndex={-1}>
        <Routes>
        <Route path="/" exact element={<Home />} />
        <Route path="/archives" element={<Archives />} />
        <Route path="/account/login" element={<Login />} />
        <Route path="/account/forgot-password" element={<ForgotPassword />} />
        <Route
          path="/account/reset-password/:uuid"
          element={<ResetPassword />}
        />
        <Route
          path="/account/verify/:uuid"
          element={<VerifyEmail />}
        />
        <Route path="/account/register" element={<Register />} />
        <Route path="/help" element={<Help />} />
        <Route path="/search" element={<Search />} />
        <Route path="/manage/projects" element={<Dashboard />} />
        <Route path="/manage/account" element={<Account />} />
        <Route path="/namespace/create" element={<NamespaceForm />} />
        <Route path="/users/:user" element={<UserPage />} />
        <Route
          path="/packages/:namespace_name/:package_name"
          element={<PackagePage />}
        />
        <Route path="/namespaces/:namespace" element={<NamespacePage />} />
        <Route path="/admin" element={<AdminSection />} />
        <Route path="*" element={<NoPage />} />
        </Routes>
      </main>
      <footer className="app-footer">
        <Container className="app-footer__inner">
          <p className="mb-0">
            The official registry for{" "}
            <a href="https://fpm.fortran-lang.org/">fpm</a>, the Fortran Package
            Manager.
          </p>
        </Container>
      </footer>
    </BrowserRouter>
  );
}

export default App;
