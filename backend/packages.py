from app import app
from mongo import db
from mongo import file_storage
from bson.objectid import ObjectId
from flask import request, jsonify, abort, send_from_directory
from gridfs.errors import NoFile
from datetime import datetime, timedelta
from auth import generate_uuid, IS_VERCEL
from app import swagger
import tarfile
import os
import toml
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
from models.package import Package
from models.package import Version
from bson import json_util


parameters = {
    "name": "name",
    "author": "author",
    "createdat": "createdAt",
    "updatedat": "updatedAt",
    "downloads": "downloads",
}


def is_valid_version_str(version_str):
    """
    Function to verify whether the version string is valid or not.

    Parameters:
    version_str: The version string to be validated.

    Returns:
    bool: True if the version_str is valid.
    """

    try:
        semantic_version.Version(version_str)
        return True
    except:
        return False


def is_valid_license_identifier(license_str):
    """
    Function to check whether the license string is a valid identifier or not.

    Parameters:
    license_str (str): The SPDX license identifier string to be validated.

    Returns:
    bool: True if the string is a valid SPDX license identifier, False otherwise.
    """
    try:
        licensing = get_spdx_licensing()
        licensing.parse(license_str, validate=True)
        return True
    except:
        return False


@app.route("/packages", methods=["GET"])
@swag_from("documentation/search_packages.yaml", methods=["GET"])
def search_packages():
    query = request.args.get("query")
    page = request.args.get("page")
    sorted_by = request.args.get("sorted_by")
    sort = request.args.get("sort")
    sorted_by = sorted_by.lower() if sorted_by else "name"
    query = query if query else "fortran"
    sort = -1 if sort == "desc" else 1
    sorted_by = (
        parameters[sorted_by.lower()]
        if sorted_by.lower() in parameters.keys()
        else "name"
    )
    page = int_validation(page,0)
    query = unquote(query.strip().lower())
    packages_per_page = 10

    mongo_db_query = {
        "$and": [
            {
                "$or": [
                    {"name": {"$regex": query}},
                    {"keywords": {"$in": [query]}},
                    {"categories": {"$in": [query]}},
                    {"description": {"$regex": query}},
                ]
            },
            {"is_deprecated": False},
        ]
    }

    packages = (
        db.packages.find(
            mongo_db_query,
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
            },
        )
        .sort(sorted_by, sort)
        .limit(packages_per_page)
        .skip(page * packages_per_page)
    )

    if packages:
        # Count the number of documents in the database related to query.
        total_documents = db.packages.count_documents(mongo_db_query)

        total_pages = math.ceil(total_documents / packages_per_page)

        search_packages = []
        for i in packages:
            package_obj = Package.from_json(i)

            search_packages.append({
                "name": package_obj.name,
                "namespace": package_obj.namespace_name,
                "description": package_obj.description,
                "keywords": package_obj.keywords+package_obj.categories,
                "updated_at": package_obj.updated_at,
            })
        return (
            jsonify(
                {"code": 200, "packages": search_packages, "total_pages": total_pages}
            ),
            200,
        )
    else:
        return (
            jsonify({"status": "error", "message": "packages not found", "code": 404}),
            404,
        )

def int_validation(param,default_value):
    try:
        return int(param)
    except:
        return default_value

@app.route("/packages_cli", methods=["GET"])
@swag_from("documentation/search_packages_cli.yaml", methods=["GET"])
def search_packages_cli():
    query = request.args.get("query")
    page = request.args.get("page")
    license = request.args.get("license")
    namespace = "" if request.args.get("namespace")== '*' else request.args.get("namespace")
    package = "" if request.args.get("package") == "*" else request.args.get("package")
    packages_per_page = request.args.get("limit")
    sorted_by = request.args.get("sorted_by")
    sort = request.args.get("sort")
    sorted_by = sorted_by.lower() if sorted_by else "name"
    query = query if query else "fortran"
    sort = -1 if sort == "desc" else 1 
    sorted_by = (
        parameters[sorted_by.lower()]
        if sorted_by.lower() in parameters.keys()
        else "name"
    )
    query = unquote(query.strip().lower())
    page = int_validation(page,0)-1
    packages_per_page = int_validation(packages_per_page,10)

    conditions = [
    {"namespace_name": {"$regex": namespace, "$options": "i"}} if namespace else None,
    {"license": {"$regex": license, "$options": "i"}} if license else None,
    {"name": {"$regex": package, "$options": "i"}} if package else None,
    ]

    mongo_db_query = {
        "$and": [
          {
            "$or": [
                    {"registry_description": {"$regex": query, "$options": "i"}},
                    {"description": {"$regex": query, "$options": "i"}},
                   ]
            },
            {"is_deprecated": False},
        ]
    }
    mongo_db_query["$and"].extend(cond for cond in conditions if cond)
    total_documents = db.packages.count_documents(mongo_db_query)

    packages_per_page = total_documents if packages_per_page > total_documents else packages_per_page

    packages = (
        db.packages.find(mongo_db_query)
        .sort(sorted_by, sort)
        .limit(packages_per_page)
        .skip(page * packages_per_page)
    )

    if packages:
        total_pages = math.ceil(total_documents / packages_per_page)

        search_packages = []
        for i in packages:
            package_obj = Package.from_json(i)

            search_packages.append({
                "name": package_obj.name,
                "namespace": package_obj.namespace_name,
                "description": package_obj.description,
                "version": package_obj.versions[-1].version,
            })
        return (
            jsonify(
                {"code": 200, "packages": search_packages, "total_pages": total_pages}
            ),
            200,
        )
    else:
        return (
            jsonify({"status": "error", "message": "packages not found", "code": 404}),
            404,
        )


@app.route("/packages", methods=["POST"])
@swag_from("documentation/package_upload.yaml", methods=["POST"])
def upload():
    upload_token = request.form.get("upload_token")
    package_name = request.form.get("package_name")
    package_version = request.form.get("package_version")
    package_license = request.form.get("package_license")
    dry_run = request.form.get("dry_run")
    tarball = request.files["tarball"]

    dry_run = True if dry_run == "true" else False

    if not upload_token:
        return jsonify({"code": 400, "message": "Upload token missing"}), 400

    if not package_name:
        return jsonify({"code": 400, "message": "Package name is missing"}), 400

    if not package_version:
        return jsonify({"code": 400, "message": "Package version is missing"}), 400

    if not package_license:
        return jsonify({"code": 400, "message": "Package license is missing"}), 400

    # Check whether version string is valid or not.
    if package_version == "0.0.0" or not is_valid_version_str(package_version):
        return jsonify({"code": 400, "message": "Version is not valid"}), 400

    # Check whether license identifier is valid or not.
    if not is_valid_license_identifier(license_str=package_license):
        return (
            jsonify(
                {
                    "code": 400,
                    "message": f"Invalid license identifier {package_license}. Please check the SPDX license identifier list.",
                }
            ),
            400,
        )

    # Find the document that contains the upload token.
    namespace_doc = db.namespaces.find_one(
        {"upload_tokens": {"$elemMatch": {"token": upload_token}}}
    )

    if not namespace_doc:
        return jsonify({"code": 401, "message": "Invalid upload token"}), 401

    if namespace_doc:
        namespace_obj = Namespace.from_json(namespace_doc)
        upload_token_doc = next(
            item
            for item in namespace_doc["upload_tokens"]
            if item["token"] == upload_token
        )
        package_doc = db.packages.find_one(
            {"name": package_name, "namespace": namespace_obj.id}
        )

    # Check if the token is expired.
    # Expire the token after one week of it's creation.
    if check_token_expiry(upload_token_created_at=upload_token_doc["createdAt"]):
        return (
            jsonify(
                {
                    "code": 401,
                    "message": "Upload token has been expired. Please generate a new one",
                }
            ),
            401,
        )

    # Get the user connected to the upload token.
    user_id = upload_token_doc["createdBy"]
    user = db.users.find_one({"_id": user_id})

    if not user:
        return jsonify({"code": 404, "message": "User not found"}), 404
    
    user_obj = User.from_json(user)

    if not package_doc:
        # User should be either namespace maintainer or namespace admin to upload a package.
        if checkUserUnauthorizedForNamespaceTokenCreation(
            user_id=user_obj.id, namespace_obj=namespace_obj
        ):
            return jsonify({"code": 401, "message": "Unauthorized"}), 401
    else:
        # User should be either namespace maintainer or namespace admin or package maintainer to upload a package.
        package_obj = Package.from_json(package_doc)
        if checkUserUnauthorized(
            user_id=user_obj.id,
            package_namespace=namespace_obj,
            package_obj=package_obj,
        ):
            return jsonify({"message": "Unauthorized", "code": 401}), 401

    package_doc = db.packages.find_one(
        {"name": package_name, "namespace": namespace_obj.id}
    )

    if tarball.content_type not in [
        "application/gzip",
        "application/zip",
        "application/octet-stream",
        "application/x-tar",
    ]:
        return jsonify({"code": 400, "message": "Invalid file type"}), 400

    tarball_name = "{}-{}.tar.gz".format(package_name, package_version)

    package_data = {
        "repository": "Package Under Verification",
        "description": "Package Under Verification",
        "copyright": "Package Under Verification",
        "homepage": "Package Under Verification",
        "registry_description": "Package Under Verification",
    }

    file_url = f"{package_name}_{package_version}_{tarball_name}"
    file_object_id = file_storage.put(
        data=file_url, content_type="application/text", filename=tarball_name, encoding="utf-8", metadata={'url':file_url}
    )

    static_dir = os.path.join("static", "packages")
    if not os.path.exists(static_dir):
        os.makedirs(static_dir)
    file_path = os.path.join(static_dir, file_url)
    tarball.save(file_path)

    try:
        # Save the tarball to the directory

        # Optionally verify the tarball (e.g., check if it's a valid tar.gz file)
        with tarfile.open(file_path, "r:gz") as tar:
            tar.getnames()
    except Exception as e:
        return jsonify({"code": 400, "message": f"Invalid tarball file. {e}"}), 400

    # No previous recorded versions of the package found.
    if not package_doc:
        try:
            package_obj = Package(
                name=package_name,
                namespace=namespace_obj.id,
                namespace_name=namespace_obj.namespace,
                description=package_data["description"],
                homepage=package_data["homepage"],
                repository=package_data["repository"],
                copyright=package_data["copyright"],
                license=package_license,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                author=user_obj.id,
                maintainers=[user_obj.id],
                keywords=["fortran", "fpm"],
                categories=["fortran", "fpm"],
                is_deprecated=False,
                versions=[],
            )
        except KeyError as e:
            return (
                jsonify(
                    {
                        "code": 400,
                        "message": f"Invalid package metadata. {e} is missing",
                    }
                ),
                400,
            )
        
        version_obj = Version(
            version=package_version,
            tarball=tarball_name,
            dependencies="Test dependencies",
            created_at=datetime.utcnow(),
            is_deprecated=False,
            oid= file_object_id,
            download_url=f"/tarballs/{file_object_id}",
        )

        # Append the first version document.
        package_obj.versions.append(version_obj)

        if dry_run:
            return jsonify({"message": "Dry run Successful.", "code": 200}), 200

        db.packages.insert_one(package_obj.to_json())

        package = db.packages.find_one(
            {
                "name": package_name,
                "versions.version": package_version,
                "namespace": namespace_obj.id,
            }
        )

        # Add the package id to the namespace.
        update_namespace_obj_with_package_id(namespace_obj=namespace_obj, package=package)

        update_user_obj_with_package_id(user_obj, package["_id"])

        return jsonify({"message": "Package Uploaded Successfully.", "code": 200})
    else:
        # Check if version of the package already exists in the backend.
        package_version_doc = db.packages.find_one(
            {
                "name": package_name,
                "namespace": namespace_obj.id,
                "versions.version": package_version,
            }
        )

        if package_version_doc:
            return jsonify({"message": "Version already exists", "code": 400}), 400  

        package_obj = Package.from_json(package_doc)

        new_version = Version(
            version=package_version,
            tarball=tarball_name,
            dependencies="Test dependencies",
            created_at=datetime.utcnow(),
            is_deprecated=False,
            oid = file_object_id,
            download_url=f"/tarballs/{file_object_id}",
        )


        package_obj.versions.append(new_version)
        
        package_obj.versions = sorted(
            package_obj.versions, key=lambda x: x.version
        )
        package_obj.updatedAt = datetime.utcnow()

        if dry_run:
            return jsonify({"message": "Dry run Successful.", "code": 200}), 200

        db.packages.update_one(
            {"_id": ObjectId(package_obj.id)},
            {"$set": package_obj.to_json()},
        )

        return jsonify({"message": "Package Uploaded Successfully.", "code": 200}), 200

def update_namespace_obj_with_package_id(namespace_obj, package):
    namespace_obj.packages.append(package["_id"])
    namespace_obj.updatedAt = datetime.utcnow()
    
    db.namespaces.update_one({"_id": namespace_obj.id}, {"$set": namespace_obj.to_json()})

def update_user_obj_with_package_id(user_obj, package_id):
    # Current user is the author of the package.
    user_obj.authorOf.append(package_id)

    db.users.update_one({"_id": user_obj.id}, {"$set": user_obj.to_json()})

def check_token_expiry(upload_token_created_at):
    """
    Function to verify whether the upload token is expired or not.

    Parameters:
    upload_token_created_at (datetime): The creation date of upload token.

    Returns:
    bool: True if token is expired (older than 1 week). False otherwise.
    """
    datetime_now = datetime.utcnow()

    # Calculate the time difference between the current time and the `createdAt` time
    time_diff = datetime_now - upload_token_created_at

    # Check if the time difference is greater than 1 week
    if time_diff > timedelta(weeks=1):
        return True

    return False


@app.route("/tarballs/<oid>", methods=["GET"])
@swag_from("documentation/get_tarball.yaml", methods=["GET"])
def serve_gridfs_file(oid):
    try:
        file = list(db.tarballs.files.find({'_id':ObjectId(oid)}))[0]
        
        file_path = os.path.join("static/packages/", file['metadata']['url'])
        package_version_doc = db.tarballs.files.update_one(
            {"_id": ObjectId(oid)},
            {
                "$inc": {
                    "downloads_stats.total_downloads": 1,
                    f"downloads_stats.dates.{str(datetime.now())[:10]}": 1,
                }
            },
        )
        if package_version_doc.modified_count > 0:
            if os.path.exists(file_path):
                return send_from_directory("static/packages/", file['metadata']['url'], as_attachment=True)
            # Return the file data as a Flask response object
            # return send_file(
            #     file,
            #     download_name=file.filename,
            #     as_attachment=True,
            #     mimetype=file.content_type,
            # )
        return jsonify({"message": "Package version not found", "code": 404}), 404

    except NoFile:
        abort(404)


def check_version(current_version, new_version):
    current_list = list(map(int, current_version.split(".")))
    new_list = list(map(int, new_version.split(".")))
    return new_list > current_list


@app.route("/packages/<namespace_name>/<package_name>", methods=["GET"])
@swag_from("documentation/get_package.yaml", methods=["GET"])
def get_package(namespace_name, package_name):
    # Get package from a package_name and namespace's name.
    package = db.packages.find_one(
        {"name": package_name, "namespace_name": namespace_name}
    )

    # Check if package is not found.
    if not package:
        return jsonify({"message": "Package not found", "code": 404}), 404
    
    package_obj = Package.from_json(package)

    # Get the package author from id.
    package_author = db.users.find_one({"_id": package_obj.author})
    package_author_obj = User.from_json(package_author)

    try:  # handle the case where the package has no ratings
        ratings = round(sum(package_obj.ratings['users'].values())/len(package_obj.ratings['users']),3) if len(package_obj.ratings['users']) > 0 else 0,
        rating_count = package_obj.ratings["counts"] if "counts" in package_obj.ratings else {}
    except:
        ratings = 0
        rating_count = {}

    # package_obj.downloads_stats Data Model
    # downloads_stats:
    #     total_downloads:1
    #     versions:
    #         oid1:1 
    #         oid2:1
    #     dates:
    #         date1:
    #             oid1:1
    #             oid2:1
    #             total_downloads:1
    
    downloads_stats = dict()
    downloads_stats['versions'] = dict()
    downloads_stats['dates'] = dict()
    downloads_stats['total_downloads'] = 0
    try:
        for i in package_obj.versions:
            version_oid =  db.tarballs.files.find_one({"_id": ObjectId(i.oid)})
            downloads_stats['versions'][str(i.oid)] = version_oid['downloads_stats']['total_downloads']
            downloads_stats['total_downloads'] += version_oid['downloads_stats']['total_downloads']
            for DATE_VALUE in version_oid['downloads_stats']['dates']:
                downloads_stats['dates'][DATE_VALUE] = dict()
                downloads_stats['dates'][DATE_VALUE][str(i.oid)] = version_oid['downloads_stats']['dates'][DATE_VALUE]
            for i in downloads_stats['dates']:
                downloads_stats['dates'][i]['total_downloads'] = sum(downloads_stats['dates'][i].values())
    except:
        downloads_stats = dict()

    version_history = [{k: v for k, v in i.items() if k != 'tarball'} for i in package_obj.to_json()["versions"]]
    latest_version_data = package_obj.versions[-1].to_json()
    latest_version_data['oid'] = str(latest_version_data['oid'])
    for i in version_history:
        i['oid'] = str(i['oid'])

    # Only latest version of the package will be sent as a response.
    package_response_data = {
        "name": package_obj.name,
        "namespace": package_obj.namespace_name,
        "latest_version_data": latest_version_data,
        "author": package_author_obj.username,
        "keywords": package_obj.keywords if package_obj.keywords else [],
        "categories": package_obj.categories if package_obj.categories else [],
        "license": package_obj.license,
        "created_at": package_obj.created_at,
        "version_history": version_history,
        "updated_at": package_obj.updated_at,
        "description": package_obj.description,
        "registry_description": package_obj.registry_description,
        "ratings": ratings,
        "downloads": downloads_stats,
        "ratings_count": rating_count
    }
    return jsonify({"data": package_response_data, "code": 200})


@app.route("/packages/<namespace_name>/<package_name>/verify", methods=["POST"])
@swag_from("documentation/verify_user_role.yaml", methods=["POST"])
@jwt_required()
def verify_user_role(namespace_name, package_name):
    uuid = get_jwt_identity()

    user = db.users.find_one({"uuid": uuid})

    if not user:
        return jsonify({"status": "error", "message": "Unauthorized", "code": 401}), 401

    namespace = db.namespaces.find_one({"namespace": namespace_name})

    if not namespace:
        return (
            jsonify({"status": "error", "message": "Namespace not found", "code": 404}),
            404,
        )

    package = db.packages.find_one(
        {"name": package_name, "namespace": namespace_name}
    )

    if not package:
        return (
            jsonify({"status": "error", "message": "Package not found", "code": 404}),
            404,
        )
    
    user_obj = User.from_json(user)
    package_obj = Package.from_json(package)
    namespace_obj = Namespace.from_json(namespace)

    if (
        str(user_obj.id) in [str(obj_id) for obj_id in namespace_obj.maintainers]
        or str(user_obj.id) in [str(obj_id) for obj_id in namespace_obj.admins]
        or str(user_obj.id) in [str(obj_id) for obj_id in package_obj.maintainers]
    ):
        return jsonify({"status": "success", "code": 200, "isVerified": True}), 200
    else:
        return jsonify({"status": "error", "code": 401, "isVerified": False}), 401


@app.route("/packages/<namespace_name>/<package_name>/<version>", methods=["GET"])
@swag_from("documentation/get_version.yaml", methods=["GET"])
def get_package_from_version(namespace_name, package_name, version):
    # Get package from a package_name, namespace_name and version.
    package = db.packages.find_one(
        {
            "name": package_name,
            "namespace_name": namespace_name,
            "versions.version": version,
        }
    )

    # Check if package is not found.
    if not package:
        return jsonify({"message": "Package not found", "code": 404}), 404

    else:
        package_obj = Package.from_json(package)

        # Get the package author from id.
        package_author = db.users.find_one({"_id": package_obj.author})

        package_author_obj = User.from_json(package_author)

        # Extract version data from the list of versions.
        version_history = package_obj.versions
        version_data = next(
            filter(lambda obj: obj.version == version, version_history), None
        )
        version_history = version_data.to_json()
        version_history['oid'] = str(version_history['oid'])
        # Only queried version should be sent as response.
        package_response_data = {
            "name": package_obj.name,
            "namespace": package_obj.namespace_name,
            "author": package_author_obj.username,
            "keywords": package_obj.keywords,
            "categories": package_obj.categories,
            "license": package_obj.license,
            "created_at": package_obj.created_at,
            "version_data": version_history,
            "updatedAt": package_obj.updated_at,
            "description": package_obj.description,
        }

        return jsonify({"data": package_response_data, "code": 200}), 200


@app.route("/packages/<namespace_name>/<package_name>/delete", methods=["POST"])
@swag_from("documentation/delete_package.yaml", methods=["POST"])
@jwt_required()
def delete_package(namespace_name, package_name):
    uuid = get_jwt_identity()

    user = db.users.find_one({"uuid": uuid})

    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user_obj = User.from_json(user)

    # Check if the user is authorized to delete the package.
    if not "admin" in user_obj.roles:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "User is not authorized to delete the package",
                    "code": 401,
                }
            ),
            401,
        )

    # Get the namespace from the namespace name.
    namespace = db.namespaces.find_one({"namespace": namespace_name})

    if not namespace:
        return jsonify({"message": "Namespace not found", "code": 404}), 404

    # Find package using package_name & namespace_name.
    package = db.packages.find_one(
        {"name": package_name, "namespace": namespace["_id"]}
    )

    # If package is not found. Return 404.
    if not package:
        return jsonify({"message": "Package not found", "code": 404})

    package_deleted = db.packages.delete_one(
        {"name": package_name, "namespace": namespace["_id"]}
    )

    if package_deleted.deleted_count > 0:
        return jsonify({"message": "Package deleted successfully", "code": 200}), 200
    else:
        return jsonify({"message": "Internal Server Error", "code": 500}), 500


@app.route(
    "/packages/<namespace_name>/<package_name>/<version>/delete", methods=["POST"]
)
@swag_from("documentation/delete_package_version.yaml", methods=["POST"])
@jwt_required()
def delete_package_version(namespace_name, package_name, version):
    uuid = get_jwt_identity()

    user = db.users.find_one({"uuid": uuid})

    if not user:
        return jsonify({"message": "User not found", "code": 404}), 404
    
    user_obj = User.from_json(user)

    # Check if the user is authorized to delete the package.
    if not "admin" in user_obj.roles:
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "User is not authorized to delete the package",
                    "code": 401,
                }
            ),
            401,
        )

    # Get the namespace from the namespace name.
    namespace = db.namespaces.find_one({"namespace": namespace_name})

    # Check if namespace does not exists.
    if not namespace:
        return jsonify({"message": "Namespace does not found", "code": 404}), 404

    # Perform the pull operation.
    result = db.packages.update_one(
        {"name": package_name, "namespace": namespace["_id"]},
        {"$pull": {"versions": {"version": version}}},
    )

    if result.matched_count:
        return jsonify({"message": "Package version deleted successfully"}), 200
    else:
        return (
            jsonify(
                {"status": "error", "message": "Package version not found", "code": 404}
            ),
            404,
        )


@app.route("/packages/<namespace_name>/<package_name>/uploadToken", methods=["POST"])
@swag_from("documentation/create_package_upload_token.yaml", methods=["POST"])
@jwt_required()
def create_token_upload_token_package(namespace_name, package_name):
    uuid = get_jwt_identity()

    # Get the user from uuid.
    user_doc = db.users.find_one({"uuid": uuid})

    if not user_doc:
        return jsonify({"code": 401, "message": "Unauthorized"}), 401

    # Get the namespace from namespace_name.
    namespace_doc = db.namespaces.find_one({"namespace": namespace_name})

    if not namespace_doc:
        return jsonify({"code": 404, "message": "Namespace not found"}), 404
    
    namespace_obj = Namespace.from_json(namespace_doc)

    # Get the package from package_name & namespace_id.
    package_doc = db.packages.find_one(
        {"name": package_name, "namespace": namespace_obj.id}
    )

    if not package_doc:
        return jsonify({"code": 404, "message": "Package not found"}), 404
    
    package_obj = Package.from_json(package_doc)
    user_obj = User.from_json(user_doc)

    # Check if the user is authorized to generate package token.
    # Only package maintainers will have the option to generate tokens for a package.
    if not str(user_obj.id) in [
        str(obj_id) for obj_id in package_obj.maintainers
    ]:
        return (
            jsonify(
                {"code": 401, "message": "Only package maintainers can create tokens"}
            ),
            401,
        )

    # Generate the token.
    upload_token = generate_uuid()

    upload_token_obj = {
        "token": upload_token,
        "created_at": datetime.utcnow(),
        "created_by": user_doc["_id"],
    }

    db.packages.update_one(
        {"_id": package_obj.id}, {"$addToSet": {"upload_tokens": upload_token_obj}}
    )

    return (
        jsonify(
            {
                "code": 200,
                "message": "Upload token created successfully",
                "upload_token": upload_token,
            }
        ),
        200,
    )


@app.route("/packages/<namespace>/<package>/maintainers", methods=["GET","POST"])
@swag_from("documentation/package_maintainers.yaml", methods=["GET","POST"])
def package_maintainers(namespace, package):

    namespace_doc = db.namespaces.find_one({"namespace": namespace})

    if not namespace_doc:
        return jsonify({"message": "Namespace not found", "code": 404})
    
    namespace_obj = Namespace.from_json(namespace_doc)

    package_doc = db.packages.find_one(
        {"name": package, "namespace": namespace_obj.id}
    )

    if not package_doc:
        return jsonify({"message": "Package not found", "code": 404})
    
    package_obj = Package.from_json(package_doc)

    maintainers = []

    for i in package_obj.maintainers:
        maintainer = db.users.find_one({"_id": ObjectId(i)}, {"_id": 1, "username": 1})
        maintainer_obj = User.from_json(maintainer)
        maintainers.append(
            {"id": str(maintainer_obj.id), "username": maintainer_obj.username}
        )

    return jsonify({"code": 200, "users": maintainers}), 200


def sort_versions(versions):
    """
    Sorts the list of version in the reverse order. Such that the latest version comes at
    0th index.
    """
    return sorted(versions, key=lambda x: [int(i) for i in x.split(".")], reverse=True)


# This function checks if user is authorized to upload/update a package in a namespace.
def checkUserUnauthorized(user_id, package_namespace, package_obj):
    admins_id_list = [str(obj_id) for obj_id in package_namespace.admins]
    maintainers_id_list = [str(obj_id) for obj_id in package_namespace.maintainers]
    pkg_maintainers_id_list = [str(obj_id) for obj_id in package_obj.maintainers]
    str_user_id = str(user_id)
    return (
        str_user_id not in admins_id_list
        and str_user_id not in maintainers_id_list
        and str_user_id not in pkg_maintainers_id_list
    )


def checkUserUnauthorizedForNamespaceTokenCreation(user_id, namespace_obj):
    admins_id_list = [str(obj_id) for obj_id in namespace_obj.admins]
    maintainers_id_list = [str(obj_id) for obj_id in namespace_obj.maintainers]
    str_user_id = str(user_id)
    return str_user_id not in admins_id_list and str_user_id not in maintainers_id_list


@app.route("/ratings/<namespace>/<package>", methods=["POST"])
@swag_from("documentation/post_rating.yaml", methods=["POST"])
@jwt_required()
def post_ratings(namespace, package):
    uuid = get_jwt_identity()
    rating = request.form.get("rating")

    if not rating:
        return jsonify({"code": 400, "message": "Rating is missing"}), 400

    if int(rating) < 1 or int(rating) > 5:
        return (
            jsonify({"code": 400, "message": "Rating should be between 1 and 5"}),
            400,
        )

    user = db.users.find_one({"uuid": uuid})
    if not user:
        return jsonify({"code": 404, "message": "User not found"}), 404
    
    namespace_doc = db.namespaces.find_one({"namespace": namespace})
    if not namespace_doc:
        return jsonify({"code": 404, "message": "Namespace not found"}), 404
    package_doc = db.packages.find_one(
        {"name": package, "namespace": namespace_doc["_id"]}
    )
    if not package_doc:
        return jsonify({"code": 404, "message": "Package not found"}), 404

    db.packages.update_one(
        {"name": package, "namespace": namespace_doc["_id"]},
        {
            "$set": {
                f"ratings.users.{user['_id']}": int(rating),
            },
        },
    )

    # Iterate through ratings and calculate how many users rated 5, 4, 3, 2, 1.
    ratings = db.packages.find_one(
        {"name": package, "namespace": namespace_doc["_id"]}
    )["ratings"]["users"]

    ratings_count = {
        "5": 0,
        "4": 0,
        "3": 0,
        "2": 0,
        "1": 0,
    }

    for user_id, user_rating in ratings.items():
        if user_rating == 5:
            ratings_count["5"] += 1
        elif user_rating == 4:
            ratings_count["4"] += 1
        elif user_rating == 3:
            ratings_count["3"] += 1
        elif user_rating == 2:
            ratings_count["2"] += 1
        elif user_rating == 1:
            ratings_count["1"] += 1

    db.packages.update_one(
        {"name": package, "namespace": namespace_doc["_id"]},
        {
            "$set": {
                "ratings.counts": ratings_count,
            },
        },
    )
    
    return jsonify({"message": "Ratings Submitted Successfully", "code": 200}), 200


@app.route("/report/<namespace>/<package>", methods=["POST"])
@swag_from("documentation/post_malicious.yaml", methods=["POST"])
@jwt_required()
def post_malicious(namespace, package):
    uuid = get_jwt_identity()
    reason = request.form.get("reason")

    if not reason:
        return jsonify({"code": 400, "message": "Reason is missing"}), 400
    
    reason = reason.strip()

    if len(reason) < 10:
        return (
            jsonify({"code": 400, "message": "Reason should atleast be 10 characters"}),
            400,
        )

    user = db.users.find_one({"uuid": uuid})

    if not user:
        return jsonify({"code": 404, "message": "User not found"}), 404
    
    namespace_doc = db.namespaces.find_one({"namespace": namespace})
    if not namespace_doc:
        return jsonify({"code": 404, "message": "Namespace not found"}), 404
    package_doc = db.packages.find_one(
        {"name": package, "namespace": namespace_doc["_id"]}
    )
    if not package_doc:
        return jsonify({"code": 404, "message": "Package not found"}), 404

    package_version_doc = db.packages.update_one(
        {"name": package, "namespace": namespace_doc["_id"]},
        {
            "$set": {
                f"malicious_report.users.{user['_id']}": { 'reason': str(reason), 'isViewed': False },
                "malicious_report.isViewed": False,
            }
        },
    )
    return jsonify({"message": "Malicious Report Submitted Successfully", "code": 200}), 200

@app.route("/report/view", methods=["GET"])
@swag_from("documentation/view_report.yaml", methods=["GET"])
@jwt_required()
def view_report():
    uuid = get_jwt_identity()

    user = db.users.find_one({"uuid": uuid})

    if "admin" in user["roles"]:
        non_viewed_reports = list()
        malicious_reports = db.packages.find({"malicious_report.isViewed": False})
        for package in list(malicious_reports):
            for user_id, report in package.get("malicious_report", {}).get("users", {}).items():
                if not report.get("isViewed", False):
                    report['name'] = db.users.find_one({"_id": ObjectId(user_id)}, {"username": 1})["username"]
                    del report["isViewed"]
                    report["package"] = package["name"]
                    report["namespace"] = db.namespaces.find_one({"_id": package["namespace"]}, {"namespace": 1})["namespace"]
                    non_viewed_reports.append(report)

        return jsonify({"message": "Malicious Reports fetched Successfully", "code": 200, "reports": non_viewed_reports}), 200


    return jsonify({"message": "Unauthorized", "code": 401}), 401

