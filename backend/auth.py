import os
from dotenv import load_dotenv
from flask import request, jsonify
from datetime import datetime
from uuid import uuid4
from app import app
from mongo import db
import hashlib
from app import swagger
import smtplib
from flasgger.utils import swag_from
from flask_jwt_extended import jwt_required, create_access_token, create_refresh_token, get_jwt_identity
from models.user import User

load_dotenv()

env_var = dict()

try:
    salt = os.getenv("SALT")
    sudo_password = os.getenv("SUDO_PASSWORD")
    fortran_email = os.getenv("RESET_EMAIL")
    fortran_password = os.getenv("RESET_PASSWORD")
    is_ci = os.getenv("IS_CI", "false")
    host = os.getenv("HOST")
    IS_VERCEL = os.getenv("IS_VERCEL")
    env_var["host"] = host
    env_var["salt"] = salt
    env_var["sudo_password"] = sudo_password
    if is_ci!="true":
        host = "smtp.gmail.com"
        port = 587  # TLS replaced SSL in 1999
        # smtp = smtplib.SMTP("smtp.gmail.com", 587)
        # smtp.starttls()
        # smtp.login(fortran_email, fortran_password)

except KeyError as err:
    print("Add SALT to .env file")


def generate_uuid():
    while True:
        uuid = uuid4().hex
        user = db.users.find_one({"uuid": uuid})
        if not user:
            return uuid

@app.route("/auth/login", methods=["POST"])
@swag_from("documentation/login.yaml", methods=["POST"])
def login():
    salt = env_var["salt"]
    user_identifier = request.form.get("user_identifier")
    password = request.form.get("password")
    password += salt
    hashed_password = hashlib.sha256(password.encode()).hexdigest()
    query = {
        "$and": [
            {"$or": [{"email": user_identifier}, {"username": user_identifier}]},
            {"password": hashed_password},
        ]
    }

    # search for the user both by user name or email
    user = db.users.find_one(query)

    if not user:
        return jsonify({"message": "Invalid email or password", "code": 401}), 401
    
    user = User.from_json(user)

    if not user.isVerified and is_ci!='true':    # TODO: Uncomment this line to enable email verification
        return jsonify({"message": "Please verify your email", "code": 401}), 401

    access_token = create_access_token(identity=user.uuid)
    refresh_token = create_refresh_token(identity=user.uuid)

    db.users.update_one(
        {"_id": user.id},
        {
            "$set": {
                "loginAt": datetime.utcnow(),
            }
        },
    )

    return (
        jsonify(
            {
                "message": "Login successful",
                "access_token": access_token,
                "refresh_token": refresh_token,
                "username": user.username,
                "code": 200,
            }
        ),
        200,
    )


@app.route("/auth/signup", methods=["POST"])
@swag_from("documentation/signup.yaml", methods=["POST"])
def signup():
    sudo_password = env_var["sudo_password"]
    salt = env_var["salt"]
    uuid = generate_uuid()

    username = request.form.get("username")
    email = request.form.get("email")
    email = email.lower()
    password = request.form.get("password")

    if not username:
        return jsonify({"message": "Username is required", "code": 400}), 400

    if not email:
        return jsonify({"message": "Email is required", "code": 400}), 400

    if not password:
        return jsonify({"message": "Password is required", "code": 400}), 400

    password += salt
    sudo_password += salt
    sudo_hashed_password = hashlib.sha256(sudo_password.encode()).hexdigest()
    hashed_password = hashlib.sha256(password.encode()).hexdigest()
    registry_user = db.users.find_one(
        {"$or": [{"username": username}, {"email": email}]}
    )

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

    if not registry_user:
        if hashed_password == sudo_hashed_password:
            user.roles = ["admin"]
        else:
            user.roles = ["user"]
        db.users.insert_one(user.to_json())
        send_verify_email(email) if is_ci != 'true' else None
        return (
            jsonify(
                {
                    "message": "Signup successful, Please verify your email",
                    "code": 200,
                }
            ),
            200,
        )
    else:
        return (
            jsonify(
                {
                    "message": "A user with this email or username already exists",
                    "code": 400,
                }
            ),
            400,
        )


@app.route("/auth/logout", methods=["POST"])
@swag_from("documentation/logout.yaml", methods=["POST"])
@jwt_required()
def logout():
    uuid = get_jwt_identity()

    user = db.users.find_one({"uuid": uuid})
    if not user:
        return jsonify({"message": "User not found", "code": 404})
    
    user = User.from_json(user)

    db.users.update_one(
        {"_id": user.id},
        {
            "$set": {
                "lastLogout": datetime.utcnow(),
            }
        },
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
    salt = env_var["salt"]

    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user = User.from_json(user)
    
    if old_password:
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
@jwt_required()
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

    message = f"""\n
    Dear {user.username},

    We received a request to reset your password. To reset your password, please copy paste the link below in a new browser window:

    {env_var['host']}/account/reset-password/{user.uuid}

    Thank you,
    The Fortran-lang Team"""

    message = f"Subject: Password reset link\nTo: {email}\n{message}"

    # sending the mail
    smtp.sendmail(to_addrs=email, msg=message, from_addr=fortran_email)

    return (
        jsonify({"message": "Password reset link sent to your email", "code": 200}),
        200,
    )


def send_verify_email(email):
    query = {"$and": [{"$or": [{"email": email}, {"newEmail": email}]}]}

    user = db.users.find_one(query)

    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404

    uuid = user["uuid"]

    message = f"""\n
    Dear {user['username']},

    We received a request to verify your email. To verify your email, please copy paste the link below in a new browser window:

    {env_var['host']}/account/verify/{uuid}

    Thank you,
    The Fortran-lang Team"""

    message = f"Subject: Verify email \nTo: {email}\n{message}"

    # sending the mail
    smtp.sendmail(to_addrs=email, msg=message, from_addr=fortran_email)

    return (
        jsonify({"message": "verification link sent to your email", "code": 200}),
        200,
    )


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
            {"uuid": uuid}, {"$set": {"email": user.newEmail, "newEmail": ""}}
        )
    
    if not user.isVerified:
        db.users.update_one({"uuid": uuid}, {"$set": {"isVerified": True}})

    access_token = create_access_token(identity=user.uuid)
    refresh_token = create_refresh_token(identity=user.uuid)

    return jsonify({"message": "Successfully Verified Email", "access_token": access_token, "refresh_token": refresh_token, "code": 200}), 200


@app.route("/auth/change-email", methods=["POST"])
@jwt_required()
def change_email():
    uuid = get_jwt_identity()
    new_email = request.form.get("new_email")

    if not uuid:
        return jsonify({"message": "Unauthorized", "code": 401}), 401

    user = db.users.find_one({"uuid": uuid})

    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user = User.from_json(user)

    if not new_email:
        return jsonify({"message": "Please enter new email", "code": 400}), 400

    used_email = db.users.find_one({"email": new_email})

    if used_email:
        return jsonify({"message": "Email already in use", "code": 400}), 400

    db.users.update_one(
        {"uuid": uuid},
        {"$set": {"newEmail": new_email}},
    )
    send_verify_email(new_email)

    return jsonify({"message": "Please verify your new email.", "code": 200}), 200
