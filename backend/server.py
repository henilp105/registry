"""
FPM Registry Server Entry Point
"""
import os
import logging
from flask import jsonify
from app import app
from mongo import ensure_indexes, check_database_health

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
debug = is_ci != "true" and os.getenv("FLASK_ENV") != "production"

def initialize_app():
    """Initialize application on startup."""
    logger.info("Initializing FPM Registry...")
    
    # Ensure database indexes exist
    ensure_indexes()
    
    logger.info("FPM Registry initialized successfully")

if __name__ == "__main__":
    initialize_app()
    
    port = int(os.getenv("FLASK_SERVER_PORT", 9090))
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    
    logger.info(f"Starting server on {host}:{port} (debug={debug})")
    
    # Use threaded mode for better concurrent request handling
    app.run(
        host=host,
        port=port,
        debug=debug,
        threaded=True
    )
