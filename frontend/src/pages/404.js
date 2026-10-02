import React from "react";
import { Link } from "react-router-dom";
import "./404.css";

const NoPage = () => {
  return (
    <main className="not-found">
      <p className="not-found__code">404</p>
      <h1 className="not-found__title">Page not found</h1>
      <p className="not-found__body">
        The page you are looking for doesn&apos;t exist, or an other error
        occurred. Go to the <Link to="/">home page</Link>.
      </p>
    </main>
  );
};

export default NoPage;
