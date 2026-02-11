"""
FPM Registry Server Entry Point
"""
import os
import logging
from flask import jsonify
from app import app
from mongo import ensure_indexes, check_database_health
from mail import mailer

# Import route modules to register endpoints
import auth
import user
import packages
import namespaces

# Configure logging
logger = logging.getLogger(__name__)

# ============================================================================
# Error Handlers
# ============================================================================
@app.route("/")
def index():
    return jsonify({
        "message": "FPM Registry API",
        "version": "2.0.1",
        "status": "healthy",
        "code": 200
    })

@app.route("/health")
def health_check():
    """Health check endpoint for load balancers and monitoring."""
    db_healthy, db_latency, db_error = check_database_health()
    
    health_status = {
        "status": "healthy" if db_healthy else "unhealthy",
        "database": {
            "connected": db_healthy,
            "latency_ms": round(db_latency, 2) if db_healthy else None,
            "error": db_error
        }
    }
    
    status_code = 200 if db_healthy else 503
    return jsonify(health_status), status_code

@app.errorhandler(404)
def page_not_found(e):
    return jsonify({
        "message": "Resource not found",
        "code": 404,
        "error": "not_found"
    }), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({
        "message": "Method not allowed",
        "code": 405,
        "error": "method_not_allowed"
    }), 405

@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({
        "message": "File too large",
        "code": 413,
        "error": "payload_too_large"
    }), 413

@app.errorhandler(429)
def too_many_requests(e):
    return jsonify({
        "message": "Too many requests. Please try again later.",
        "code": 429,
        "error": "rate_limited"
    }), 429

@app.errorhandler(500)
def internal_server_error(e):
    logger.exception("Internal server error")
    return jsonify({
        "message": "Internal server error",
        "code": 500,
        "error": "internal_error"
    }), 500

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle unexpected exceptions."""
    logger.exception(f"Unhandled exception: {e}")
    return jsonify({
        "message": "An unexpected error occurred",
        "code": 500,
        "error": "internal_error"
    }), 500

# ============================================================================
# Application Startup
# ============================================================================
is_ci = os.getenv("IS_CI", "false").lower()
is_production = os.getenv("FLASK_ENV") == "production" or is_ci == "true"
debug = not is_production

def send_alert(subject: str, body: str) -> bool:
    """Send an alert email to the configured alert address.

    Returns True if email was successfully sent or attempted; False otherwise.
    """
    try:
        alert_to = os.getenv("ALERT_EMAIL", "henilp105@gmail.com")
        result = mailer.send_email(alert_to, subject, body)
        logger.info(f"Alert sent: {subject} -> {alert_to} (success={result})")
        return result
    except Exception as e:
        logger.exception(f"Failed to send alert: {e}")
        return False


def initialize_app():
    """Initialize application on startup."""
    logger.info("Initializing FPM Registry...")
    
    # Ensure database indexes exist
    ensure_indexes()
    
    logger.info("FPM Registry initialized successfully")

    # Send startup alert
    try:
        import socket, subprocess, datetime
        host = socket.gethostname()
        ts = datetime.datetime.utcnow().isoformat() + 'Z'
        commit = None
        try:
            commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"]).decode().strip()
        except Exception:
            commit = 'unknown'
        body = f"Service started on {host} at {ts}\nCommit: {commit}\nStatus: initialized"
        send_alert("FPM Registry started", body)
    except Exception:
        logger.exception("Failed to send startup alert")

# Initialize app on module load (for Gunicorn)
initialize_app()

# Register graceful shutdown handlers to send alerts on SIGTERM/SIGINT
import signal
import sys
import datetime

ALERT_EMAIL = os.getenv("ALERT_EMAIL", "henilp105@gmail.com")


def _on_shutdown(signum, frame):
    try:
        host = __import__('socket').gethostname()
        ts = datetime.datetime.utcnow().isoformat() + 'Z'
        body = f"Service stopping on {host} at {ts} (signal={signum})"
        send_alert("FPM Registry stopping", body)
    except Exception:
        logger.exception("Error while sending shutdown alert")
    finally:
        # Allow the process to terminate after alerting
        try:
            sys.exit(0)
        except SystemExit:
            raise

# Register handlers
signal.signal(signal.SIGTERM, _on_shutdown)
signal.signal(signal.SIGINT, _on_shutdown)

# Unhandled exception hook: send email then re-raise
def _handle_exception(exc_type, exc_value, exc_traceback):
    try:
        import traceback
        tb = ''.join(traceback.format_exception(exc_type, exc_value, exc_traceback))
        host = __import__('socket').gethostname()
        ts = datetime.datetime.utcnow().isoformat() + 'Z'
        body = f"Unhandled exception on {host} at {ts}\n\n{tb}"
        send_alert("FPM Registry exception", body)
    except Exception:
        logger.exception("Failed to send exception alert")
    # Call default excepthook
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

sys.excepthook = _handle_exception

if __name__ == "__main__":
    port = int(os.getenv("FLASK_SERVER_PORT", 9090))
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    
    if is_production:
        # Production: Use Gunicorn (this block is for reference, actual startup via CMD)
        logger.info(f"Production mode: Use 'gunicorn -w 4 -b {host}:{port} server:app'")
    else:
        # Development: Use Flask's built-in server
        logger.info(f"Starting dev server on {host}:{port} (debug={debug})")
        app.run(
            host=host,
            port=port,
            debug=debug,
            threaded=True
        )
