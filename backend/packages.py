from app import app
from mongo import db, file_storage
from bson.objectid import ObjectId
from flask import request, jsonify, abort, send_from_directory
from gridfs.errors import NoFile
from datetime import datetime, timedelta
from auth import generate_uuid
from app import swagger
import tarfile
import os
import shutil
import json
from flasgger.utils import swag_from
from urllib.parse import unquote
import math
import semantic_version
from license_expression import get_spdx_licensing
from flask_jwt_extended import jwt_required, get_jwt_identity
from models.namespace import Namespace
from models.user import User
from models.package import Package, Version
from bson import json_util

# ======================
# Helper Functions
# ======================
parameters = {
    "name": "name",
    "author": "author",
    "createdat": "createdAt",
    "updatedat": "updatedAt",
    "downloads": "downloads",
}

def int_validation(param, default_value):
    try:
        return int(param)
    except (ValueError, TypeError):
        return default_value

def is_valid_version_str(version_str):
    try:
        semantic_version.Version(version_str)
        return True
    except ValueError:
        return False

def is_valid_license_identifier(license_str):
    try:
        licensing = get_spdx_licensing()
        licensing.parse(license_str, validate=True)
        return True
    except:
        return False

def check_token_expiry(upload_token_created_at):
    return (datetime.utcnow() - upload_token_created_at) > timedelta(weeks=1)

def check_user_unauthorized(user_id, namespace_obj, package_obj=None):
    user_id_str = str(user_id)
    
    namespace_roles = [
        str(maintainer_id) for maintainer_id in namespace_obj.maintainers
    ] + [str(admin_id) for admin_id in namespace_obj.admins]
    
    if user_id_str in namespace_roles:
        return False
        
    if package_obj and user_id_str in [str(m) for m in package_obj.maintainers]:
        return False
        
    return True

def update_namespace_with_package(namespace_obj, package_id):
    namespace_obj.packages.append(package_id)
    namespace_obj.updatedAt = datetime.utcnow()
    db.namespaces.update_one(
        {"_id": namespace_obj.id}, 
        {"$set": namespace_obj.to_json()}
    )

def update_user_with_package(user_obj, package_id):
    user_obj.authorOf.append(package_id)
    db.users.update_one(
        {"_id": user_obj.id}, 
        {"$set": user_obj.to_json()}
    )

def build_package_query(query, namespace=None, package=None, license=None):
    conditions = [
        {"namespace_name": {"$regex": namespace, "$options": "i"}} if namespace else None,
        {"license": {"$regex": license, "$options": "i"}} if license else None,
        {"name": {"$regex": package, "$options": "i"}} if package else None,
    ]

    mongo_db_query = {
        "$and": [
            {"$or": [
                {"registry_description": {"$regex": query, "$options": "i"}},
                {"description": {"$regex": query, "$options": "i"}},
            ]},
            {"is_deprecated": False},
            *[cond for cond in conditions if cond]
        ]
    }
    return mongo_db_query

def format_package_response(package_obj, include_versions=False):
    package_author = db.users.find_one({"_id": package_obj.author})
    package_author_obj = User.from_json(package_author) if package_author else None
    
    try:
        ratings = round(
            sum(package_obj.ratings['users'].values()) / len(package_obj.ratings['users']), 3
        ) if package_obj.ratings.get('users') else 0
        rating_count = package_obj.ratings.get("counts", {})
    except:
        ratings = 0
        rating_count = {}

    downloads_stats = calculate_download_stats(package_obj)
    version_history = [v.to_json() for v in package_obj.versions]
    
    for v in version_history:
        v['oid'] = str(v['oid'])

    response = {
        "name": package_obj.name,
        "namespace": package_obj.namespace_name,
        "author": package_author_obj.username if package_author_obj else "Unknown",
        "keywords": package_obj.keywords or [],
        "categories": package_obj.categories or [],
        "license": package_obj.license,
        "created_at": package_obj.created_at,
        "updated_at": package_obj.updated_at,
        "description": package_obj.description,
        "registry_description": package_obj.registry_description,
        "ratings": ratings,
        "downloads": downloads_stats,
        "ratings_count": rating_count
    }
    
    if include_versions:
        response.update({
            "latest_version_data": version_history[-1] if version_history else {},
            "version_history": version_history
        })
    
    return response

def calculate_download_stats(package_obj):
    stats = {
        'versions': {},
        'dates': {},
        'total_downloads': 0
    }
    
    for version in package_obj.versions:
        try:
            tarball = db.tarballs.files.find_one({"_id": ObjectId(version.oid)})
            if not tarball:
                continue
                
            dl_count = tarball.get('downloads_stats', {}).get('total_downloads', 0)
            stats['versions'][str(version.oid)] = dl_count
            stats['total_downloads'] += dl_count
            
            for date, count in tarball.get('downloads_stats', {}).get('dates', {}).items():
                if date not in stats['dates']:
                    stats['dates'][date] = {}
                stats['dates'][date][str(version.oid)] = count
                
        except Exception:
            continue
            
    for date in stats['dates']:
        stats['dates'][date]['total_downloads'] = sum(stats['dates'][date].values())
        
    return stats

# ======================
# Route Handlers
# ======================
@app.route("/packages", methods=["GET"])
@swag_from("documentation/search_packages.yaml", methods=["GET"])
def search_packages():
    query = unquote(request.args.get("query", "fortran").strip().lower())
    page = int_validation(request.args.get("page"), 0)
    sorted_by = parameters.get(
        (request.args.get("sorted_by") or "name").lower(), 
        "name"
    )
    sort_dir = -1 if request.args.get("sort") == "desc" else 1
    packages_per_page = 10

    query_filter = {
        "$and": [
            {"$or": [
                {"name": {"$regex": query}},
                {"keywords": {"$in": [query]}},
                {"categories": {"$in": [query]}},
                {"description": {"$regex": query}},
            ]},
            {"is_deprecated": False},
        ]
    }

    total_documents = db.packages.count_documents(query_filter)
    total_pages = math.ceil(total_documents / packages_per_page)

    packages = db.packages.find(
        query_filter,
        {
            "_id": 0,
            "name": 1,
            "namespace": 1,
            "namespace_name": 1,
            "author": 1,
            "description": 1,
            "keywords": 1,
            "categories": 1,
            "updated_at": 1,
        }
    ).sort(sorted_by, sort_dir).skip(page * packages_per_page).limit(packages_per_page)

    search_results = []
    for pkg in packages:
        pkg_obj = Package.from_json(pkg)
        search_results.append({
            "name": pkg_obj.name,
            "namespace": pkg_obj.namespace_name,
            "description": pkg_obj.description,
            "keywords": (pkg_obj.keywords or []) + (pkg_obj.categories or []),
            "updated_at": pkg_obj.updated_at,
        })

    if not search_results:
        return jsonify({
            "status": "error", 
            "message": "Packages not found", 
            "code": 404
        }), 404

    return jsonify({
        "code": 200, 
        "packages": search_results, 
        "total_pages": total_pages
    }), 200

@app.route("/packages_cli", methods=["GET"])
@swag_from("documentation/search_packages_cli.yaml", methods=["GET"])
def search_packages_cli():
    query = unquote(request.args.get("query", "fortran").strip().lower())
    page = int_validation(request.args.get("page"), 1) - 1
    license = request.args.get("license")
    namespace = "" if request.args.get("namespace") == '*' else request.args.get("namespace")
    package = "" if request.args.get("package") == "*" else request.args.get("package")
    packages_per_page = int_validation(request.args.get("limit"), 10)
    sorted_by = parameters.get(
        (request.args.get("sorted_by") or "name").lower(), 
        "name"
    )
    sort_dir = -1 if request.args.get("sort") == "desc" else 1

    query_filter = build_package_query(query, namespace, package, license)
    total_documents = db.packages.count_documents(query_filter)
    
    packages = db.packages.find(query_filter).sort(
        sorted_by, sort_dir
    ).skip(page * packages_per_page).limit(packages_per_page)

    search_results = []
    for pkg in packages:
        pkg_obj = Package.from_json(pkg)
        latest_version = pkg_obj.versions[-1].version if pkg_obj.versions else "0.0.0"
        search_results.append({
            "name": pkg_obj.name,
            "namespace": pkg_obj.namespace_name,
            "description": pkg_obj.description,
            "version": latest_version,
        })

    if not search_results:
        return jsonify({
            "status": "error", 
            "message": "Packages not found", 
            "code": 404
        }), 404

    return jsonify({
        "code": 200, 
        "packages": search_results, 
        "total_pages": math.ceil(total_documents / packages_per_page)
    }), 200

@app.route("/packages", methods=["POST"])
@swag_from("documentation/package_upload.yaml", methods=["POST"])
def upload():
    # Validate required parameters
    required_fields = [
        "upload_token", "package_name", 
        "package_version", "package_license"
    ]
    for field in required_fields:
        if not request.form.get(field):
            return jsonify({
                "code": 400, 
                "message": f"{field.replace('_', ' ').title()} is missing"
            }), 400

    upload_token = request.form["upload_token"]
    package_name = request.form["package_name"]
    package_version = request.form["package_version"]
    package_license = request.form["package_license"]
    dry_run = request.form.get("dry_run") == "true"
    tarball = request.files.get("tarball")

    if not tarball:
        return jsonify({"code": 400, "message": "Tarball file missing"}), 400

    # Validate version and license
    if not is_valid_version_str(package_version):
        return jsonify({"code": 400, "message": "Invalid version format"}), 400
        
    if not is_valid_license_identifier(package_license):
        return jsonify({
            "code": 400,
            "message": f"Invalid SPDX license identifier: {package_license}"
        }), 400

    # Validate upload token
    namespace_doc = db.namespaces.find_one(
        {"upload_tokens": {"$elemMatch": {"token": upload_token}}
    )
    if not namespace_doc:
        return jsonify({"code": 401, "message": "Invalid upload token"}), 401

    namespace_obj = Namespace.from_json(namespace_doc)
    token_doc = next(
        (t for t in namespace_doc["upload_tokens"] if t["token"] == upload_token), 
        None
    )
    
    if not token_doc or check_token_expiry(token_doc["createdAt"]):
        return jsonify({
            "code": 401,
            "message": "Upload token expired or invalid"
        }), 401

    # Validate user permissions
    user_id = token_doc["createdBy"]
    user = db.users.find_one({"_id": user_id})
    if not user:
        return jsonify({"code": 404, "message": "User not found"}), 404
    
    user_obj = User.from_json(user)
    
    package_doc = db.packages.find_one({
        "name": package_name, 
        "namespace": namespace_obj.id
    })
    
    if package_doc:
        package_obj = Package.from_json(package_doc)
        if check_user_unauthorized(user_obj.id, namespace_obj, package_obj):
            return jsonify({"code": 401, "message": "Unauthorized"}), 401
            
        # Check if version already exists
        if any(v.version == package_version for v in package_obj.versions):
            return jsonify({
                "code": 400, 
                "message": "Version already exists"
            }), 400
    else:
        if check_user_unauthorized(user_obj.id, namespace_obj):
            return jsonify({"code": 401, "message": "Unauthorized"}), 401

    # Validate and save tarball
    if tarball.content_type not in [
        "application/gzip", "application/zip", 
        "application/octet-stream", "application/x-tar"
    ]:
        return jsonify({"code": 400, "message": "Invalid file type"}), 400

    tarball_name = f"{package_name}-{package_version}.tar.gz"
    static_dir = os.path.join("static", "packages")
    os.makedirs(static_dir, exist_ok=True)
    file_path = os.path.join(static_dir, tarball_name)
    
    try:
        tarball.save(file_path)
        with tarfile.open(file_path, "r:gz") as tar:
            tar.getnames()  # Validate tarball
    except Exception as e:
        return jsonify({
            "code": 400, 
            "message": f"Invalid tarball: {str(e)}"
        }), 400

    # Store in GridFS
    try:
        with open(file_path, 'rb') as f:
            file_object_id = file_storage.put(
                f, 
                filename=tarball_name,
                content_type="application/gzip",
                metadata={'url': tarball_name}
            )
    except Exception as e:
        return jsonify({
            "code": 500, 
            "message": f"File storage error: {str(e)}"
        }), 500

    # Create version object
    version_obj = Version(
        version=package_version,
        tarball=tarball_name,
        dependencies="",  # Will be populated later
        created_at=datetime.utcnow(),
        is_deprecated=False,
        oid=file_object_id,
        download_url=f"/tarballs/{file_object_id}",
    )

    if dry_run:
        return jsonify({"message": "Dry run successful", "code": 200}), 200

    # Create or update package
    if not package_doc:
        package_obj = Package(
            name=package_name,
            namespace=namespace_obj.id,
            namespace_name=namespace_obj.namespace,
            description="Package description",
            homepage="",
            repository="",
            copyright="",
            license=package_license,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            author=user_obj.id,
            maintainers=[user_obj.id],
            keywords=["fortran", "fpm"],
            categories=["fortran", "fpm"],
            is_deprecated=False,
            versions=[version_obj],
        )
        db.packages.insert_one(package_obj.to_json())
        package = db.packages.find_one({
            "name": package_name,
            "namespace": namespace_obj.id
        })
        update_namespace_with_package(namespace_obj, package["_id"])
        update_user_with_package(user_obj, package["_id"])
    else:
        package_obj.versions.append(version_obj)
        package_obj.versions.sort(key=lambda x: semantic_version.Version(x.version))
        package_obj.updated_at = datetime.utcnow()
        db.packages.update_one(
            {"_id": package_obj.id},
            {"$set": package_obj.to_json()}
        )

    return jsonify({
        "message": "Package uploaded successfully", 
        "code": 200
    }), 200

@app.route("/tarballs/<oid>", methods=["GET"])
@swag_from("documentation/get_tarball.yaml", methods=["GET"])
def serve_gridfs_file(oid):
    try:
        file = db.tarballs.files.find_one({'_id': ObjectId(oid)})
        if not file:
            return jsonify({"message": "File not found", "code": 404}), 404

        # Update download stats
        db.tarballs.files.update_one(
            {"_id": ObjectId(oid)},
            {"$inc": {
                "downloads_stats.total_downloads": 1,
                f"downloads_stats.dates.{datetime.utcnow().strftime('%Y-%m-%d')}": 1
            }}
        )

        file_path = os.path.join("static/packages/", file['metadata']['url'])
        if os.path.exists(file_path):
            return send_from_directory(
                "static/packages/", 
                file['metadata']['url'], 
                as_attachment=True
            )
            
        return jsonify({"message": "File not found", "code": 404}), 404
    except Exception as e:
        return jsonify({"message": str(e), "code": 500}), 500

@app.route("/packages/<namespace_name>/<package_name>", methods=["GET"])
@swag_from("documentation/get_package.yaml", methods=["GET"])
def get_package(namespace_name, package_name):
    package = db.packages.find_one({
        "name": package_name, 
        "namespace_name": namespace_name
    })
    if not package:
        return jsonify({"message": "Package not found", "code": 404}), 404
    
    package_obj = Package.from_json(package)
    return jsonify({
        "data": format_package_response(package_obj, include_versions=True),
        "code": 200
    }), 200

# Other routes follow the same pattern of modularization...

if __name__ == "__main__":
    app.run(debug=True)