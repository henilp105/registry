import React, { useEffect } from "react";
import Spinner from "react-bootstrap/Spinner";
import { useDispatch, useSelector } from "react-redux";
import Container from "react-bootstrap/Container";
import { fetchArchiveData } from "../store/actions/archivesActions";

const Archives = () => {
  const archives = useSelector((state) => state.archives.archives);
  const dispatch = useDispatch();
  const isLoading = useSelector((state) => state.archives.isLoading);

  useEffect(() => {
    dispatch(fetchArchiveData());
  }, [dispatch]);

  // Unified style configuration
  const styles = {
    container: {
      width: "95%",
      maxWidth: "1200px",
      margin: "0 auto",
      padding: "40px 20px",
      fontFamily: "'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
      color: "#2d3748",
      lineHeight: "1.6",
      fontSize: "18px",
      textAlign: "left"
    },
    header: {
      // fontSize: "2.5rem",
      fontWeight: "700",
      color: "#2b6cb0",
      marginBottom: "30px",
      paddingBottom: "15px",
      borderBottom: "2px solid #e2e8f0",
      textAlign: "left"
    },
    sectionTitle: {
      fontSize: "1.8rem",
      fontWeight: "600",
      color: "#3182ce",
      margin: "25px 0 15px 0",
      textAlign: "left"
    },
    paragraph: {
      marginBottom: "16px",
      paddingLeft: "0",
      maxWidth: "100%",
      textAlign: "left",
      fontSize: "16px"
    },
    highlight: {
      backgroundColor: "#ebf8ff",
      padding: "3px 6px",
      borderRadius: "4px",
      fontWeight: "500"
    },
    archiveList: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
      gap: "20px",
      margin: "30px 0"
    },
    archiveCard: {
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      padding: "20px",
      backgroundColor: "#fff",
      boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
      transition: "all 0.3s ease",
      "&:hover": {
        transform: "translateY(-3px)",
        boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
        borderColor: "#cbd5e0"
      }
    },
    archiveLink: {
      display: "flex",
      alignItems: "center",
      textDecoration: "none",
      color: "#3182ce",
      fontWeight: "500",
      fontSize: "16px"
    },
    archiveIcon: {
      marginRight: "10px",
      fontSize: "20px"
    },
    archiveMeta: {
      marginTop: "10px",
      fontSize: "14px",
      color: "#718096"
    },
    loadingContainer: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "70vh"
    }
  };

  return !isLoading ? (
    <div style={styles.container}>
      <h1 style={styles.header}>Registry Archives</h1>
      
      <section>
        <h2 style={styles.sectionTitle}>Weekly Registry Snapshots</h2>
        <p style={{...styles.paragraph, paddingLeft: "25px"}}>
          This collection contains weekly archives of our package registry, preserving 
          historical snapshots of all namespaces, packages, and tarballs. These archives 
          serve as a valuable resource for tracking the evolution of the registry over time.
          Each archive captures a complete snapshot of the registry at a specific point in time, 
          allowing you to:
        </p>
        
        <ul style={{ ...styles.paragraph, paddingLeft: "25px" }}>
          <li>Track changes and updates to packages</li>
          <li>Recover previous versions if needed</li>
          <li>Analyze historical registry growth</li>
          <li>Audit package changes over time</li>
        </ul>
      </section>
      
      <section>
        <h2 style={styles.sectionTitle}>Available Archives</h2>
        <p style={styles.paragraph}>
          Archives are generated automatically every week. Click any archive to download:
        </p>
        
        <div style={styles.archiveList}>
          {archives.map((archive, index) => (
            <div key={index} style={styles.archiveCard}>
              <a
                href={`${process.env.REACT_APP_REGISTRY_API_URL}/static/${archive}`}
                style={styles.archiveLink}
                download
              >
                <span style={styles.archiveIcon}>📦</span>
                {archive}
              </a>
              <div style={styles.archiveMeta}>
                {archive.includes('tar.gz') ? 'Tarball Archive' : 'Archive File'} | 
                {archive.match(/\d{4}-\d{2}-\d{2}/) 
                  ? ` Snapshot from ${archive.match(/\d{4}-\d{2}-\d{2}/)[0]}`
                  : ' Weekly Snapshot'}
              </div>
            </div>
          ))}
        </div>
      </section>
      
      <section>
        <h2 style={styles.sectionTitle}>Using Archives</h2>
        <p style={styles.paragraph}>
          To use these archives, simply download and extract them. Each archive contains:
        </p>
        
        <div style={{ 
          backgroundColor: "#f7fafc", 
          padding: "20px", 
          borderRadius: "8px",
          margin: "20px 0"
        }}>
          <ul style={{ paddingLeft: "20px" }}>
            <li>A complete copy of all registry metadata at the time of snapshot</li>
            <li>Package tarballs in their original form</li>
            <li>Namespace and package structure information</li>
            <li>JSON index files for easy processing</li>
          </ul>
        </div>
        
        <p style={styles.paragraph}>
          <span style={styles.highlight}>Note:</span> Archives are read-only and cannot be 
          uploaded back to the registry. They are intended for reference and historical purposes.
        </p>
      </section>
    </div>
  ) : (
    <Container style={styles.loadingContainer}>
      <Spinner animation="border" role="status" variant="primary">
        <span className="visually-hidden">Loading Archives...</span>
      </Spinner>
      <span style={{ marginLeft: "15px", fontSize: "18px" }}>Loading Archives...</span>
    </Container>
  );
};

export default Archives;