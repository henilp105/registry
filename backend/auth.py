"""
Authentication module for FPM Registry.
Handles user authentication, registration, and password management.
"""
import os
import logging
from dotenv import load_dotenv
from flask import request, jsonify
from datetime import datetime
from uuid import uuid4
import bcrypt
from flasgger.utils import swag_from
from flask_jwt_extended import jwt_required, create_access_token, create_refresh_token, get_jwt_identity

from app import app
from mongo import db
from models.user import User
from mail import mailer
from utils.responses import (
    success_response, error_response, unauthorized_response,
    not_found_response, validation_error_response
)
from utils.validators import validate_email, validate_password, validate_username

load_dotenv()
logger = logging.getLogger(__name__)

# Configuration
is_ci = os.getenv("IS_CI", "false").lower()
SUDO_PASSWORD = os.getenv("SUDO_PASSWORD", "")
BCRYPT_ROUNDS = int(os.getenv("BCRYPT_ROUNDS", 12))

# Legacy salt for migration (to be removed after migration)
LEGACY_SALT = os.getenv("SALT", "")


def generate_uuid():
    """
    Generate a unique UUID for a new user.
    Checks database to ensure uniqueness.
    """
    max_attempts = 10
    for _ in range(max_attempts):
        uuid = uuid4().hex
        if not db.users.find_one({"uuid": uuid}, {"_id": 1}):
            return uuid
    raise RuntimeError("Failed to generate unique UUID")


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.
    """
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    return bcrypt.hashpw(password_bytes, salt).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    """
    Verify a password against its hash.
    Supports both bcrypt and legacy SHA256 hashes for migration.
    """
    try:
        # Try bcrypt first
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except ValueError:
        # Fallback to legacy SHA256 for old passwords
        import hashlib
        legacy_hash = hashlib.sha256((password + LEGACY_SALT).encode()).hexdigest()
        return legacy_hash == hashed


def migrate_password_if_needed(user_doc, password: str):
    """
    Migrate legacy SHA256 password to bcrypt.
    """
    current_hash = user_doc.get('password', '')
    if not current_hash.startswith('$2'):
        # Legacy password, migrate to bcrypt
        new_hash = hash_password(password)
        db.users.update_one(
            {"_id": user_doc["_id"]},
            {"$set": {"password": new_hash}}
        )
        logger.info(f"Migrated password to bcrypt for user {user_doc.get('username')}")


@app.route("/auth/login", methods=["POST"])
@swag_from("documentation/login.yaml", methods=["POST"])
def login():
    """
    Authenticate user and return JWT tokens.
    """
    user_identifier = request.form.get("user_identifier", "").strip()
    password = request.form.get("password", "")

    if not user_identifier:
        return error_response("Email or username is required", 400)
    if not password:
        return error_response("Password is required", 400)

    # Find user by email or username
    user_doc = db.users.find_one({
        "$or": [
            {"email": user_identifier.lower()},
            {"username": user_identifier}
        ]
    })

    if not user_doc:
        return unauthorized_response("Invalid email or password")
    
    # Verify password
    if not verify_password(password, user_doc.get('password', '')):
        return unauthorized_response("Invalid email or password")
    
    user = User.from_json(user_doc)
    
    # Check email verification
    if not user.isVerified and is_ci != 'true':
        return unauthorized_response("Please verify your email")

    # Migrate password if using legacy hash
    migrate_password_if_needed(user_doc, password)

    # Generate tokens
    access_token = create_access_token(identity=user.uuid)
    refresh_token = create_refresh_token(identity=user.uuid)

    # Update login timestamp
    db.users.update_one(
        {"_id": user_doc["_id"]},
        {"$set": {"loginAt": datetime.utcnow()}}
    )

    return jsonify({
        "message": "Login successful",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "username": user.username,
        "code": 200,
    }), 200


@app.route("/auth/signup", methods=["POST"])
@swag_from("documentation/signup.yaml", methods=["POST"])
def signup():
    """
    Register a new user account.
    """
    username = request.form.get("username", "").strip()
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")

    # Validate inputs
    is_valid, error = validate_username(username)
    if not is_valid:
        return error_response(error, 400)
    
    is_valid, error = validate_email(email)
    if not is_valid:
        return error_response(error, 400)
    
    is_valid, error = validate_password(password)
    if not is_valid:
        return error_response(error, 400)

    # Check for existing user
    existing_user = db.users.find_one(
        {"$or": [{"username": username}, {"email": email}]},
        {"_id": 1, "username": 1, "email": 1}
    )
    
    if existing_user:
        if existing_user.get("email") == email:
            return error_response("An account with this email already exists", 400)
        return error_response("This username is already taken", 400)

    try:
        uuid = generate_uuid()
        hashed_password = hash_password(password)
        
        # Check if this is the first admin user
        is_admin = password == SUDO_PASSWORD and SUDO_PASSWORD
        
        user = User(
            id=None,
            username=username,
            email=email,
            password=hashed_password,
            lastLogout=None,
            login_at=datetime.utcnow(),
            created_at=datetime.utcnow(),
            uuid=uuid,
            is_verified=False,
            new_email='',
        )
        user.roles = ["admin"] if is_admin else ["user"]
        
        db.users.insert_one(user.to_json())
        
        # Send verification email (skip in CI)
        if is_ci != 'true':
            mailer.send_verification_email(email, username, uuid)
        
        logger.info(f"New user registered: {username}")
        
        return jsonify({
            "message": "Signup successful. Please verify your email.",
            "code": 200,
        }), 200
        
    except Exception as e:
        logger.exception(f"Error during signup: {e}")
        return error_response("An error occurred during registration", 500)
    else:
        return jsonify({
            "message": "A user with this email or username already exists",
            "code": 400,
        }), 400


@app.route("/auth/logout", methods=["POST"])
@swag_from("documentation/logout.yaml", methods=["POST"])
@jwt_required()
def logout():
    uuid = get_jwt_identity()
    user = db.users.find_one({"uuid": uuid})
    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user = User.from_json(user)
    db.users.update_one(
        {"_id": user.id},
        {"$set": {"lastLogout": datetime.utcnow()}},
    )

    return jsonify({"message": "Logout successful", "code": 200}), 200


@app.route("/auth/reset-password", methods=["POST"])
@swag_from("documentation/reset_password.yaml", methods=["POST"])
@jwt_required()
def reset_password():
    uuid = get_jwt_identity()
    new_password = request.form.get("password")
    old_password = request.form.get("oldpassword")

    if not new_password:
        return jsonify({"message": "Please enter new password", "code": 400}), 400
    if not old_password:
        return jsonify({"message": "Please enter old password", "code": 400}), 400

    user = db.users.find_one({"uuid": uuid})
    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user = User.from_json(user)
    salt = env_var["salt"]
    
    old_password += salt
    hashed_password = hashlib.sha256(old_password.encode()).hexdigest()
    if hashed_password != user.password:
        return jsonify({"message": "Invalid old password", "code": 401}), 401

    new_password += salt
    hashed_password = hashlib.sha256(new_password.encode()).hexdigest()
    db.users.update_one(
        {"uuid": uuid},
        {"$set": {"password": hashed_password}},
    )
    return jsonify({"message": "Password reset successful", "code": 200}), 200


@app.route("/auth/forgot-password", methods=["POST"])
@swag_from("documentation/forgot_password.yaml", methods=["POST"])
def forgot_password(*email):
    try:
        email = request.form.get("email") if request.form.get("email") else email[0]
    except:
        return jsonify({"message": "Email is required", "code": 400}), 400

    user = db.users.find_one({"email": email})
    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user = User.from_json(user)

    if not user.isVerified:
        return jsonify({"message": "Please verify your email", "code": 401}), 401

    mailer.send_password_reset_email(email, user.username, user.uuid)
    return jsonify({
        "message": "Password reset link sent to your email", 
        "code": 200
    }), 200


@app.route("/auth/verify-email", methods=["POST"])
def verify_email():
    uuid = request.form.get("uuid")
    if not uuid:
        return jsonify({"message": "Unauthorized", "code": 401}), 401

    user = db.users.find_one({"uuid": uuid})
    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user = User.from_json(user)

    if user.newEmail != "":
        db.users.update_one(
            {"uuid": uuid}, 
            {"$set": {"email": user.newEmail, "newEmail": ""}}
        )
    
    if not user.isVerified:
        db.users.update_one({"uuid": uuid}, {"$set": {"isVerified": True}})

    access_token = create_access_token(identity=user.uuid)
    refresh_token = create_refresh_token(identity=user.uuid)

    return jsonify({
        "message": "Successfully Verified Email", 
        "access_token": access_token, 
        "refresh_token": refresh_token, 
        "code": 200
    }), 200


@app.route("/auth/change-email", methods=["POST"])
@jwt_required()
def change_email():
    uuid = get_jwt_identity()
    new_email = request.form.get("new_email")

    if not new_email:
        return jsonify({"message": "Please enter new email", "code": 400}), 400

    user = db.users.find_one({"uuid": uuid})
    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user = User.from_json(user)

    used_email = db.users.find_one({"email": new_email})
    if used_email:
        return jsonify({"message": "Email already in use", "code": 400}), 400

    db.users.update_one(
        {"uuid": uuid},
        {"$set": {"newEmail": new_email}},
    )
    
    mailer.send_verification_email(new_email, user.username, user.uuid)
    return jsonify({"message": "Please verify your new email.", "code": 200}), 200