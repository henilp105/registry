import re
from datetime import datetime
from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from flasgger.utils import swag_from

from app import app
from mongo import db
from auth import generate_uuid
from packages import checkUserUnauthorizedForNamespaceTokenCreation
from models.namespace import Namespace
from models.user import User

# Constants
NAMESPACE_NAME_PATTERN = r'^[a-zA-Z0-9_-]+$'
HTTP_200_OK = 200
HTTP_400_BAD_REQUEST = 400
HTTP_401_UNAUTHORIZED = 401
HTTP_404_NOT_FOUND = 404
HTTP_500_INTERNAL_SERVER_ERROR = 500

def get_request_data():
    """Get data from request with support for both JSON and form data."""
    if request.is_json:
        return request.get_json()
    return request.form

def fetch_user(uuid):
    """Fetch user by UUID or return None if not found."""
    return db.users.find_one({"uuid": uuid})

def fetch_namespace(namespace_name):
    """Fetch namespace by name or return None if not found."""
    return db.namespaces.find_one({"namespace": namespace_name})

def validate_namespace_name(namespace_name):
    """Validate namespace name format."""
    if not re.match(NAMESPACE_NAME_PATTERN, namespace_name):
        return jsonify({
            "code": HTTP_400_BAD_REQUEST,
            "message": "Namespace name can only include letters, numbers, hyphens and underscores"
        }), HTTP_400_BAD_REQUEST
    return None

def build_package_response(package, namespace_name, author_map):
    """Build package response object."""
    return {
        "namespace": namespace_name,
        "name": package["name"],
        "description": package["description"],
        "author": author_map.get(package["author"], "Unknown"),
        "updated_at": package["updated_at"],
        "keywords": list(set(package.get("keywords", []) + package.get("categories", []))),
    }

@app.route("/namespaces", methods=["POST"])
@swag_from("documentation/create_namespace.yaml", methods=["POST"])
@jwt_required()
def create_namespace():
    uuid = get_jwt_identity()
    user_doc = fetch_user(uuid)
    if not user_doc:
        return jsonify({"code": HTTP_401_UNAUTHORIZED, "message": "Unauthorized"}), HTTP_401_UNAUTHORIZED
    
    data = get_request_data()
    namespace_name = data.get("namespace")
    namespace_description = data.get("namespace_description")

    if not namespace_name:
        return jsonify({"code": HTTP_400_BAD_REQUEST, "message": "Namespace name is required"}), HTTP_400_BAD_REQUEST
    if not namespace_description:
        return jsonify({"code": HTTP_400_BAD_REQUEST, "message": "Namespace description is required"}), HTTP_400_BAD_REQUEST

    if error := validate_namespace_name(namespace_name):
        return error

    if fetch_namespace(namespace_name):
        return jsonify({"code": HTTP_400_BAD_REQUEST, "message": "Namespace already exists"}), HTTP_400_BAD_REQUEST

    user_obj = User.from_json(user_doc)
    namespace = Namespace(
        namespace=namespace_name,
        description=namespace_description,
        author=user_obj.id,
        maintainers=[user_obj.id],
        admins=[user_obj.id],
        packages=[],
    )

    db.namespaces.insert_one(namespace.to_json())
    return jsonify({
        "code": HTTP_200_OK,
        "message": "Namespace created successfully"
    }), HTTP_200_OK

@app.route("/namespaces/<namespace_name>/uploadToken", methods=["POST"])
@swag_from("documentation/create_namespace_upload_token.yaml", methods=["POST"])
@jwt_required()
def create_upload_token(namespace_name):
    uuid = get_jwt_identity()
    user_doc = fetch_user(uuid)
    if not user_doc:
        return jsonify({"code": HTTP_401_UNAUTHORIZED, "message": "Unauthorized"}), HTTP_401_UNAUTHORIZED
    
    namespace_doc = fetch_namespace(namespace_name)
    if not namespace_doc:
        return jsonify({"code": HTTP_404_NOT_FOUND, "message": "Namespace not found"}), HTTP_404_NOT_FOUND

    user_obj = User.from_json(user_doc)
    namespace_obj = Namespace.from_json(namespace_doc)

    if checkUserUnauthorizedForNamespaceTokenCreation(user_id=user_obj.id, namespace_obj=namespace_obj):
        return jsonify({"code": HTTP_401_UNAUTHORIZED, "message": "Unauthorized"}), HTTP_401_UNAUTHORIZED

    upload_token = generate_uuid()
    upload_token_obj = {
        "token": upload_token,
        "createdAt": datetime.utcnow(),
        "createdBy": user_obj.id
    }

    db.namespaces.update_one(
        {"namespace": namespace_name},
        {"$addToSet": {"upload_tokens": upload_token_obj}}
    )

    return jsonify({
        "code": HTTP_200_OK,
        "message": "Upload token created",
        "uploadToken": upload_token
    }), HTTP_200_OK

@app.route("/namespace/<namespace_name>/delete", methods=["POST"])
@swag_from("documentation/delete_namespace.yaml", methods=["POST"])
@jwt_required()
def delete_namespace(namespace_name):
    uuid = get_jwt_identity()
    if not uuid:
        return jsonify({"code": HTTP_401_UNAUTHORIZED, "message": "Unauthorized"}), HTTP_401_UNAUTHORIZED

    user_doc = fetch_user(uuid)
    if not user_doc:
        return jsonify({"code": HTTP_404_NOT_FOUND, "message": "User not found"}), HTTP_404_NOT_FOUND
    
    user_obj = User.from_json(user_doc)
    if "admin" not in user_obj.roles:
        return jsonify({
            "code": HTTP_401_UNAUTHORIZED,
            "message": "User is not authorized to delete the namespace"
        }), HTTP_401_UNAUTHORIZED

    namespace_doc = fetch_namespace(namespace_name)
    if not namespace_doc:
        return jsonify({"code": HTTP_404_NOT_FOUND, "message": "Namespace not found"}), HTTP_404_NOT_FOUND

    result = db.namespaces.delete_one({"namespace": namespace_name})
    if result.deleted_count == 0:
        return jsonify({
            "code": HTTP_500_INTERNAL_SERVER_ERROR,
            "message": "Failed to delete namespace"
        }), HTTP_500_INTERNAL_SERVER_ERROR

    return jsonify({
        "code": HTTP_200_OK,
        "message": "Namespace deleted successfully"
    }), HTTP_200_OK

@app.route("/namespace/<namespace>", methods=["GET"])
@swag_from("documentation/get_namespace_packages.yaml", methods=["GET"])
def namespace_packages(namespace):
    namespace_doc = fetch_namespace(namespace)
    if not namespace_doc:
        return jsonify({"code": HTTP_404_NOT_FOUND, "message": "Namespace not found"}), HTTP_404_NOT_FOUND

    namespace_obj = Namespace.from_json(namespace_doc)
    package_ids = namespace_obj.packages
    
    if not package_ids:
        return jsonify({
            "code": HTTP_200_OK,
            "packages": [],
            "createdAt": namespace_obj.createdAt
        }), HTTP_200_OK

    # Fetch all packages in single query
    packages_cursor = db.packages.find(
        {"_id": {"$in": package_ids}},
        {"_id": 0, "name": 1, "description": 1, "author": 1, "updated_at": 1,"keywords":1, "categories": 1}
    )
    packages_list = list(packages_cursor)

    # Fetch all authors in single query
    author_ids = {pkg["author"] for pkg in packages_list}
    authors_cursor = db.users.find(
        {"_id": {"$in": list(author_ids)}},
        {"_id": 1, "username": 1}
    )
    author_map = {author["_id"]: User.from_json(author).username for author in authors_cursor}

    packages = [
        build_package_response(pkg, namespace, author_map)
        for pkg in packages_list
    ]

    return jsonify({
        "code": HTTP_200_OK,
        "packages": packages,
        "createdAt": namespace_obj.createdAt
    }), HTTP_200_OK

@app.route("/namespaces/<namespace>/admins", methods=["POST"])
@swag_from("documentation/get_namespace_admins.yaml", methods=["POST"])
def namespace_admins(namespace):
    return fetch_namespace_users(namespace, "admins")

@app.route("/namespaces/<namespace>/maintainers", methods=["POST"])
@swag_from("documentation/get_namespace_maintainers.yaml", methods=["POST"])
def namespace_maintainers(namespace):
    return fetch_namespace_users(namespace, "maintainers")

def fetch_namespace_users(namespace, role_field):
    namespace_doc = fetch_namespace(namespace)
    if not namespace_doc:
        return jsonify({"code": HTTP_404_NOT_FOUND, "message": "Namespace not found"}), HTTP_404_NOT_FOUND

    namespace_obj = Namespace.from_json(namespace_doc)
    user_ids = getattr(namespace_obj, role_field, [])
    
    if not user_ids:
        return jsonify({"code": HTTP_200_OK, "users": []}), HTTP_200_OK

    users_cursor = db.users.find(
        {"_id": {"$in": user_ids}},
        {"_id": 1, "username": 1}
    )
    users = [
        {
            "id": str(user["_id"]),
            "username": User.from_json(user).username
        }
        for user in users_cursor
    ]

    return jsonify({
        "code": HTTP_200_OK,
        "users": users
    }), HTTP_200_OK