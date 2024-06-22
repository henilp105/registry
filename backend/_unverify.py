from mongo import db
import pymongo

# t = db.packages.update_many({}, {"$set": {"is_verified": False}})
# print(t.modified_count)
# packages = list(db.packages.find())

# # Step 2: Make keywords unique for each package
# for package in packages:
#     unique_keywords = list(set(package.get("categories", [])))  # Making keywords unique
#     package["categories"] = unique_keywords

# # Step 3: Store the updated packages in a list
# updated_packages = [{"_id": package["_id"], "categories": package["categories"]} for package in packages]

# # Step 4: Perform bulk update operation
# bulk_operations = [pymongo.UpdateOne({"_id": package["_id"]}, {"$set": {"categories": package["categories"]}}) for package in updated_packages]
# result = db.packages.bulk_write(bulk_operations)

# print("Number of documents matched:", result.matched_count)
# print("Number of documents modified:", result.modified_count)
# remove key k from all the documents in the collection
t = db.packages.update_many({}, {"$set": {"is_verified": False}})
# result = db.packages.update_many({}, {"$set": {"unable_to_verify": False}})
# t = list(db.packages.find())
# for i in t:
    # n = db.namespaces.find_one({"_id": i["namespace"]})['namespace']
    # db.packages.update_one({"_id": i["_id"]}, {"$set": {"description": "Package Under Verification","registry_description": "Package Under Verification"}})
    # print(i["namespace"], n)

# print("Number of documents matched:", result.matched_count)
# print("Number of documents modified:", result.modified_count)
# t = db.packages.update_many({}, {"$set": {"registry_description": "Package Under Verification"}})
# print(t.modified_count,t.matched_count)
# t = db.packages.update_many({}, {"$set": {"description": "Package Under Verification"}})
# print(t.modified_count,t.matched_count)


# report check if access_token is not undefined.

# port from namespace obj id to name #
# optimise package search, and rendering #
# readme rendering in packages  bring clarity on how to support README.md #
# registry-description #
# time and speed benchmarks #
# erase GPF # NEW RELASE NEW DB
# keywords, description, categories ( search and sort by categories and keywords https://github.com/Beliavsky?tab=repositories )  # 
# bring clarity on multiple namespaces and hierarchy #

# support catch-22 
# test-drive for module naming 
# ability to register programs as well as libraries; where plug-ins and programs could be registered and easily installed.
# fpm new folder_name --namespace n --package p --version v
# DOCS!!!!!!!!!!!!!



# tests, docs, PR reviews, CI , Vercel migration.
# fpm release, fpm pr, (meeting time + discourse support).
