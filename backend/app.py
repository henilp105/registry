import os
import logging
from datetime import timedelta
from flask import Flask, request
from flask_cors import CORS
from flasgger import Swagger
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# ============================================================================
# Security Configuration
# ============================================================================
# JWT Configuration - Use environment variable with fallback
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "fpm-registry-secret-key-change-in-production")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=int(os.getenv("JWT_ACCESS_TOKEN_DAYS", 90)))
app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(days=int(os.getenv("JWT_REFRESH_TOKEN_DAYS", 180)))
app.config["JWT_TOKEN_LOCATION"] = ["headers"]
app.config["JWT_HEADER_NAME"] = "Authorization"
app.config["JWT_HEADER_TYPE"] = "Bearer"

# Session security
app.config["SESSION_COOKIE_SECURE"] = os.getenv("FLASK_ENV") == "production"
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# General Flask configuration
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_SIZE_MB", 50)) * 1024 * 1024  # 50MB default
app.config["JSON_SORT_KEYS"] = False
app.config["JSONIFY_PRETTYPRINT_REGULAR"] = False  # Faster JSON responses

# ============================================================================
# CORS Configuration
# ============================================================================
# Get allowed origins from environment or use defaults
allowed_origins = os.getenv("CORS_ORIGINS", "*").split(",")
cors_config = {
    "origins": allowed_origins,
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
    "supports_credentials": True,
    "max_age": 86400  # Cache preflight requests for 24 hours
}
CORS(app, resources={r"/*": cors_config})

# ============================================================================
# JWT Manager
# ============================================================================
jwt = JWTManager(app)

@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    return {"message": "Token has expired", "code": 401}, 401

@jwt.invalid_token_loader
def invalid_token_callback(error):
    return {"message": "Invalid token", "code": 401}, 401

@jwt.unauthorized_loader
def missing_token_callback(error):
    return {"message": "Authorization token is missing", "code": 401}, 401

# ============================================================================
# Request Hooks for Performance Monitoring
# ============================================================================
@app.before_request
def before_request():
    """Log incoming requests and add timing."""
    import time
    request.start_time = time.time()

@app.after_request
def after_request(response):
    """Add performance headers and log slow requests."""
    import time
    
    # Calculate request duration
    if hasattr(request, 'start_time'):
        duration = (time.time() - request.start_time) * 1000
        response.headers['X-Response-Time'] = f"{duration:.2f}ms"
        
        # Log slow requests (> 500ms)
        if duration > 500:
            logger.warning(f"Slow request: {request.method} {request.path} took {duration:.2f}ms")
    
    # Security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # Cache control for static assets
    if request.path.startswith('/static'):
        response.headers['Cache-Control'] = 'public, max-age=31536000'
    
    return response

# ============================================================================
# Swagger Configuration
# ============================================================================
swagger = Swagger(
    app,
    template={
        "swagger": "2.0",
        "info": {
            "title": "FPM Registry API",
            "version": "2.0.1",
            "description": "Official API for the Fortran Package Manager Registry"
        },
        "securityDefinitions": {
            "Bearer": {
                "type": "apiKey",
                "name": "Authorization",
                "in": "header",
                "description": "JWT Authorization header using the Bearer scheme. Example: 'Bearer {token}'"
            }
        }
    },
)

# ============================================================================
# Registry Archives Route
# ============================================================================
@app.route("/registry/archives", methods=["GET"])
def get_registry_archives():
    """Get list of registry archive files."""
    import os
    from flask import jsonify
    folder_path = "static"
    try:
        file_list = os.listdir(folder_path)
        return jsonify(
            {"message": "Successfully Fetched Archives", "archives": file_list, "code": 200}
        )
    except FileNotFoundError:
        return jsonify(
            {"message": "Archives folder not found", "archives": [], "code": 200}
        )
