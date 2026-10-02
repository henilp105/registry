import React, { useEffect } from "react";
import Spinner from "react-bootstrap/Spinner";
import { useDispatch, useSelector } from "react-redux";
import Container from "react-bootstrap/Container";
import { fetchArchiveData } from "../store/actions/archivesActions";
import Icon from "../components/Icon";
import "./archives.css";

/**
 * Archive filenames are `registry-YYYY-MM-DD.tar.gz`, so the snapshot date can
 * be lifted out of the name rather than shown verbatim. Returns null for
 * anything that does not match, which the caller renders as a generic label.
 */
const describeArchive = (archive) => {
  const date = archive.match(/\d{4}-\d{2}-\d{2}/);
  const kind = archive.includes("tar.gz") ? "Tarball archive" : "Archive file";
  return {
    kind,
    date: date ? date[0] : null,
  };
};

const Archives = () => {
  const archives = useSelector((state) => state.archives.archives);
  const dispatch = useDispatch();
  const isLoading = useSelector((state) => state.archives.isLoading);

  useEffect(() => {
    dispatch(fetchArchiveData());
  }, [dispatch]);

  if (isLoading) {
    return (
      <Container className="archives__loading">
        <Spinner animation="border" role="status" variant="primary">
          <span className="visually-hidden">Loading archives</span>
        </Spinner>
        <span>Loading archives&hellip;</span>
      </Container>
    );
  }

  return (
    <div className="archives">
      <h1 className="archives__title">Registry Archives</h1>

      <section aria-labelledby="archives-snapshots">
        <h2 className="archives__section-title" id="archives-snapshots">
          Weekly Registry Snapshots
        </h2>
        <p className="archives__body archives__body--plain">
          This collection contains weekly archives of our package registry,
          preserving historical snapshots of all namespaces, packages, and
          tarballs. These archives serve as a valuable resource for tracking
          the evolution of the registry over time. Each archive captures a
          complete snapshot of the registry at a specific point in time,
          allowing you to:
        </p>

        <ul className="archives__body">
          <li>Track changes and updates to packages</li>
          <li>Recover previous versions if needed</li>
          <li>Analyze historical registry growth</li>
          <li>Audit package changes over time</li>
        </ul>
      </section>

      <section aria-labelledby="archives-available">
        <h2 className="archives__section-title" id="archives-available">
          Available Archives
        </h2>
        <p className="archives__body archives__body--plain">
          Archives are generated automatically every week. Select any archive
          to download it.
        </p>

        {archives.length === 0 ? (
          <p className="archives__empty">No archives are available yet.</p>
        ) : (
          <div className="archives__list">
            {archives.map((archive) => {
              const { kind, date } = describeArchive(archive);
              return (
                <div className="archives__card" key={archive}>
                  <a
                    // Served by the API Worker. In the Docker deployment this
                    // resolved through nginx, so the link was never exercised
                    // against the backend -- it broke silently when the web
                    // server was removed. `/archives/{name}` is the canonical
                    // path; `/static/{name}` is kept as an alias for this href.
                    href={`${process.env.REACT_APP_REGISTRY_API_URL}/archives/${archive}`}
                    className="archives__link"
                    download
                  >
                    <Icon name="archive" className="archives__icon" />
                    {archive}
                  </a>
                  <p className="archives__meta">
                    {kind}
                    {date ? ` · Snapshot from ${date}` : " · Weekly snapshot"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="archives-usage">
        <h2 className="archives__section-title" id="archives-usage">
          Using Archives
        </h2>
        <p className="archives__body archives__body--plain">
          To use these archives, download and extract them. Each archive
          contains:
        </p>

        <div className="archives__note">
          <ul className="archives__note-list">
            <li>A complete copy of all registry metadata at the time of snapshot</li>
            <li>Package tarballs in their original form</li>
            <li>Namespace and package structure information</li>
            <li>JSON index files for easy processing</li>
          </ul>
        </div>

        <p className="archives__body archives__body--plain">
          <span className="archives__highlight">Note:</span> Archives are
          read-only and cannot be uploaded back to the registry. They are
          intended for reference and historical purposes.
        </p>
      </section>
    </div>
  );
};

export default Archives;
