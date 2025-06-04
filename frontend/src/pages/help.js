import React from "react";

const Help = () => {
  // Unified style configuration - full width layout
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
      fontSize: "2.5rem",
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
    codeBlock: {
      display: "block",
      backgroundColor: "#f7fafc",
      padding: "15px 20px",
      margin: "20px 0",
      borderRadius: "6px",
      borderLeft: "4px solid #4299e1",
      fontFamily: "'Fira Code', 'Consolas', monospace",
      fontSize: "16px",
      overflowX: "auto",
      textAlign: "left",
      width: "100%"
    },
    stepContainer: {
      margin: "20px 0",
      paddingLeft: "20px",
      borderLeft: "2px dashed #cbd5e0",
      width: "100%"
    },
    listItem: {
      margin: "10px 0",
      position: "relative",
      paddingLeft: "25px",
      textAlign: "left",
      width: "100%"
    },
    listBullet: {
      position: "absolute",
      left: "0",
      top: "8px",
      width: "10px",
      height: "10px",
      backgroundColor: "#4299e1",
      borderRadius: "50%"
    },
    wideLayout: {
      display: "flex",
      flexWrap: "wrap",
      gap: "30px",
      margin: "30px 0"
    },
    wideColumn: {
      flex: "1",
      minWidth: "450px"
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>Package Registry Help Guide</h1>
      
      <div style={styles.wideLayout}>
        <div style={styles.wideColumn}>
          <section>
            <h2 style={styles.sectionTitle}>Account Registration</h2>
            <p style={styles.paragraph}>
              To publish packages to the registry, you first need to register an account:
            </p>
            
            <div style={styles.stepContainer}>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                <span style={styles.highlight}>Create an account</span> with a unique username, valid email, and secure password
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Verify your email address to activate your account
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Login to access your personal dashboard
              </div>
            </div>
          </section>
          
          <section>
            <h2 style={styles.sectionTitle}>Namespace Creation</h2>
            <p style={styles.paragraph}>
              Before uploading packages, create a namespace to organize your packages:
            </p>
            
            <div style={styles.stepContainer}>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Create a <span style={styles.highlight}>globally unique namespace</span> through your dashboard
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Namespaces prevent package naming collisions across users
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Add a descriptive name and meaningful description
              </div>
            </div>
          </section>
        </div>
        
        <div style={styles.wideColumn}>
          <section>
            <h2 style={styles.sectionTitle}>Token Management</h2>
            <p style={styles.paragraph}>
              Generate authentication tokens for secure package uploads:
            </p>
            
            <div style={styles.stepContainer}>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Access namespace tokens through your dashboard
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Tokens expire after <span style={styles.highlight}>7 days</span> by default
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Regenerate tokens anytime with one click
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Revoke tokens immediately if compromised
              </div>
            </div>
          </section>
          
          <section>
            <h2 style={styles.sectionTitle}>Package Upload Process</h2>
            <p style={styles.paragraph}>
              Publish packages using the fpm CLI with your token:
            </p>
            
            <pre style={styles.codeBlock}>fpm publish --token [your-generated-token]</pre>
            
            <div style={styles.stepContainer}>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                Successful uploads will appear instantly in your dashboard
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                CLI provides immediate feedback on upload status
              </div>
            </div>
          </section>
        </div>
      </div>
      
      <section>
        <h2 style={styles.sectionTitle}>Package Management</h2>
        <p style={styles.paragraph}>
          After successful upload, manage your packages through the dashboard:
        </p>
        
        <div style={styles.wideLayout}>
          <div style={styles.wideColumn}>
            <div style={styles.stepContainer}>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                <strong>Maintainers:</strong> Add/remove maintainers with full management privileges
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                <strong>Visibility:</strong> Control package visibility (public/private)
              </div>
            </div>
          </div>
          
          <div style={styles.wideColumn}>
            <div style={styles.stepContainer}>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                <strong>Metadata:</strong> Edit package descriptions and documentation
              </div>
              <div style={styles.listItem}>
                <div style={styles.listBullet}></div>
                <strong>Versions:</strong> Manage multiple package versions
              </div>
            </div>
          </div>
        </div>
        
        <div style={styles.stepContainer}>
          <div style={styles.listItem}>
            <div style={styles.listBullet}></div>
            <strong>Statistics:</strong> View download metrics and usage statistics
          </div>
        </div>
      </section>
      
      <section>
        <h2 style={styles.sectionTitle}>Troubleshooting</h2>
        <div style={styles.stepContainer}>
          <div style={styles.listItem}>
            <div style={styles.listBullet}></div>
            <strong>Upload failed?</strong> Check token validity and namespace permissions
          </div>
          <div style={styles.listItem}>
            <div style={styles.listBullet}></div>
            <strong>Package not appearing?</strong> Allow up to 60 seconds for processing
          </div>
          <div style={styles.listItem}>
            <div style={styles.listBullet}></div>
            <strong>CLI errors?</strong> Ensure you're using fpm version 0.8.0 or newer
          </div>
        </div>
      </section>
    </div>
  );
};

export default Help;