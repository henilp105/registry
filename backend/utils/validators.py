"""
Validation utilities for request data.
"""
import re
from typing import Optional, Tuple, List
import semantic_version
from license_expression import get_spdx_licensing

# Regex patterns
USERNAME_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{3,30}$')
EMAIL_PATTERN = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
NAMESPACE_PATTERN = re.compile(r'^[a-zA-Z0-9_-]+$')
PACKAGE_NAME_PATTERN = re.compile(r'^[a-zA-Z0-9_-]+$')
VERSION_PATTERN = re.compile(r'^\d+\.\d+\.\d+$')


def validate_username(username: str) -> Tuple[bool, Optional[str]]:
    """
    Validate username format.
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not username:
        return False, "Username is required"
    
    if len(username) < 3:
        return False, "Username must be at least 3 characters"
    
    if len(username) > 30:
        return False, "Username must be at most 30 characters"
    
    if not USERNAME_PATTERN.match(username):
        return False, "Username can only contain letters, numbers, hyphens and underscores"
    
    return True, None


def validate_email(email: str) -> Tuple[bool, Optional[str]]:
    """
    Validate email format.
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not email:
        return False, "Email is required"
    
    if not EMAIL_PATTERN.match(email):
        return False, "Invalid email format"
    
    return True, None


def validate_password(password: str) -> Tuple[bool, Optional[str]]:
    """
    Validate password strength.
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not password:
        return False, "Password is required"
    
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    
    return True, None


def validate_namespace_name(namespace: str) -> Tuple[bool, Optional[str]]:
    """
    Validate namespace name format.
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not namespace:
        return False, "Namespace name is required"
    
    if not NAMESPACE_PATTERN.match(namespace):
        return False, "Namespace name can only include letters, numbers, hyphens and underscores"
    
    return True, None


def validate_package_name(name: str) -> Tuple[bool, Optional[str]]:
    """
    Validate package name format.
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not name:
        return False, "Package name is required"
    
    if not PACKAGE_NAME_PATTERN.match(name):
        return False, "Package name can only include letters, numbers, hyphens and underscores"
    
    return True, None


def validate_version(version: str) -> Tuple[bool, Optional[str]]:
    """
    Validate semantic version string.
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not version:
        return False, "Version is required"
    
    if version == "0.0.0":
        return False, "Version 0.0.0 is not valid"
    
    try:
        semantic_version.Version(version)
        return True, None
    except Exception:
        return False, "Invalid version format. Use semantic versioning (e.g., 1.0.0)"


def validate_license(license_str: str) -> Tuple[bool, Optional[str]]:
    """
    Validate SPDX license identifier.
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not license_str:
        return False, "License is required"
    
    try:
        licensing = get_spdx_licensing()
        licensing.parse(license_str, validate=True)
        return True, None
    except Exception:
        return False, f"Invalid license identifier '{license_str}'. Please use a valid SPDX license identifier."


def sanitize_string(value: str, max_length: int = 500) -> str:
    """
    Sanitize a string by stripping whitespace and limiting length.
    """
    if not value:
        return ""
    
    return value.strip()[:max_length]


def validate_required_fields(data: dict, required: List[str]) -> Tuple[bool, Optional[dict]]:
    """
    Validate that all required fields are present and non-empty.
    
    Returns:
        Tuple of (is_valid, errors_dict)
    """
    errors = {}
    
    for field in required:
        value = data.get(field)
        if not value or (isinstance(value, str) and not value.strip()):
            errors[field] = f"{field} is required"
    
    if errors:
        return False, errors
    
    return True, None
