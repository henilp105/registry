"""
Custom decorators for route handlers.
"""
from functools import wraps
from flask import request, g
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from .responses import unauthorized_response, not_found_response, forbidden_response
import time
import logging

logger = logging.getLogger(__name__)


def get_current_user():
    """Get the current user from the database based on JWT identity."""
    from mongo import db
    from models.user import User
    
    uuid = get_jwt_identity()
    if not uuid:
        return None
    
    user_doc = db.users.find_one({"uuid": uuid})
    if not user_doc:
        return None
    
    return User.from_json(user_doc)


def require_user(f):
    """
    Decorator that requires a valid authenticated user.
    Sets g.current_user for use in the route handler.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            verify_jwt_in_request()
        except Exception:
            return unauthorized_response("Authentication required")
        
        user = get_current_user()
        if not user:
            return not_found_response("User")
        
        g.current_user = user
        return f(*args, **kwargs)
    
    return decorated_function


def require_admin(f):
    """
    Decorator that requires the user to be an admin.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            verify_jwt_in_request()
        except Exception:
            return unauthorized_response("Authentication required")
        
        user = get_current_user()
        if not user:
            return not_found_response("User")
        
        if "admin" not in user.roles:
            return forbidden_response("Admin access required")
        
        g.current_user = user
        return f(*args, **kwargs)
    
    return decorated_function


def validate_json(required_fields=None):
    """
    Decorator to validate JSON request body.
    
    Args:
        required_fields: List of required field names
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            from .responses import validation_error_response
            
            # Support both JSON and form data
            if request.is_json:
                data = request.get_json()
            else:
                data = request.form.to_dict()
            
            if not data:
                return validation_error_response("Request body is required")
            
            if required_fields:
                missing = [field for field in required_fields if not data.get(field)]
                if missing:
                    errors = {field: f"{field} is required" for field in missing}
                    return validation_error_response("Missing required fields", errors)
            
            g.request_data = data
            return f(*args, **kwargs)
        
        return decorated_function
    return decorator


def log_request(f):
    """
    Decorator to log request timing and details.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        start_time = time.time()
        
        # Execute the function
        result = f(*args, **kwargs)
        
        # Calculate duration
        duration = (time.time() - start_time) * 1000  # Convert to ms
        
        # Log if request took too long (> 500ms)
        if duration > 500:
            logger.warning(
                f"Slow request: {request.method} {request.path} took {duration:.2f}ms"
            )
        
        return result
    
    return decorated_function


def handle_exceptions(f):
    """
    Decorator to handle exceptions gracefully.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        from .responses import server_error_response
        
        try:
            return f(*args, **kwargs)
        except Exception as e:
            logger.exception(f"Unhandled exception in {f.__name__}: {str(e)}")
            return server_error_response("An unexpected error occurred")
    
    return decorated_function
