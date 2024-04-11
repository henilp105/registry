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

# print("Number of documents matched:", result.matched_count)
# print("Number of documents modified:", result.modified_count)

print(t.modified_count,t.matched_count)

# M_fixedform-0.1.2



# report check if access_token is not undefined.
#
