"""
Standardized response utilities for consistent API responses.
"""
from flask import jsonify
from functools import wraps
from typing import Any, Optional, Dict, Tuple, Union

# HTTP Status Codes
HTTP_200_OK = 200
HTTP_201_CREATED = 201
HTTP_204_NO_CONTENT = 204
HTTP_400_BAD_REQUEST = 400
HTTP_401_UNAUTHORIZED = 401
HTTP_403_FORBIDDEN = 403
HTTP_404_NOT_FOUND = 404
HTTP_409_CONFLICT = 409
HTTP_422_UNPROCESSABLE_ENTITY = 422
HTTP_429_TOO_MANY_REQUESTS = 429
HTTP_500_INTERNAL_SERVER_ERROR = 500
HTTP_501_NOT_IMPLEMENTED = 501
HTTP_503_SERVICE_UNAVAILABLE = 503


def api_response(
    data: Optional[Any] = None,
    message: str = "Success",
    code: int = HTTP_200_OK,
    **kwargs
) -> Tuple[Dict, int]:
    """
    Create a standardized API response.
    
    Args:
        data: The response data (optional)
        message: Response message
        code: HTTP status code
        **kwargs: Additional fields to include in response
        
    Returns:
        Tuple of (response_dict, status_code)
    """
    response = {
        "message": message,
        "code": code,
    }
    
    if data is not None:
        response["data"] = data
    
    # Include any additional fields
    response.update(kwargs)
    
    return jsonify(response), code


def success_response(
    data: Optional[Any] = None,
    message: str = "Success",
    **kwargs
) -> Tuple[Dict, int]:
    """Create a success response (200 OK)."""
    return api_response(data=data, message=message, code=HTTP_200_OK, **kwargs)


def created_response(
    data: Optional[Any] = None,
    message: str = "Created successfully",
    **kwargs
) -> Tuple[Dict, int]:
    """Create a created response (201 Created)."""
    return api_response(data=data, message=message, code=HTTP_201_CREATED, **kwargs)


def error_response(
    message: str,
    code: int = HTTP_400_BAD_REQUEST,
    errors: Optional[Dict] = None,
    **kwargs
) -> Tuple[Dict, int]:
    """
    Create an error response.
    
    Args:
        message: Error message
        code: HTTP status code
        errors: Dict of field-specific errors (optional)
    """
    response_data = {"status": "error"}
    if errors:
        response_data["errors"] = errors
    response_data.update(kwargs)
    
    return api_response(message=message, code=code, **response_data)


def not_found_response(
    resource: str = "Resource",
    message: Optional[str] = None
) -> Tuple[Dict, int]:
    """Create a 404 Not Found response."""
    msg = message or f"{resource} not found"
    return error_response(message=msg, code=HTTP_404_NOT_FOUND)


def unauthorized_response(
    message: str = "Unauthorized"
) -> Tuple[Dict, int]:
    """Create a 401 Unauthorized response."""
    return error_response(message=message, code=HTTP_401_UNAUTHORIZED)


def forbidden_response(
    message: str = "Forbidden"
) -> Tuple[Dict, int]:
    """Create a 403 Forbidden response."""
    return error_response(message=message, code=HTTP_403_FORBIDDEN)


def validation_error_response(
    message: str = "Validation error",
    errors: Optional[Dict] = None
) -> Tuple[Dict, int]:
    """Create a validation error response."""
    return error_response(message=message, code=HTTP_422_UNPROCESSABLE_ENTITY, errors=errors)


def conflict_response(
    message: str = "Resource already exists"
) -> Tuple[Dict, int]:
    """Create a 409 Conflict response."""
    return error_response(message=message, code=HTTP_409_CONFLICT)


def server_error_response(
    message: str = "Internal server error"
) -> Tuple[Dict, int]:
    """Create a 500 Internal Server Error response."""
    return error_response(message=message, code=HTTP_500_INTERNAL_SERVER_ERROR)
