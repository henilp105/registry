#!/usr/bin/env python3
"""
MongoDB Data Migration Script

This script migrates data from an external MongoDB database to the local
Docker MongoDB instance. It supports full database migration or selective
collection migration.

Usage:
    # Migrate all collections from source to Docker MongoDB
    python migrate_db.py --source-uri "mongodb+srv://user:pass@cluster.mongodb.net/"
    
    # Migrate specific collections only
    python migrate_db.py --source-uri "mongodb+srv://..." --collections packages namespaces users
    
    # Dry run (show what would be migrated without making changes)
    python migrate_db.py --source-uri "mongodb+srv://..." --dry-run
    
    # Clear target collections before migrating
    python migrate_db.py --source-uri "mongodb+srv://..." --clear-target

Environment Variables:
    SOURCE_MONGO_URI: Source MongoDB connection string (alternative to --source-uri)
    TARGET_MONGO_URI: Target MongoDB connection string (default: mongodb://localhost:27017/)
    MONGO_DB_NAME: Database name to migrate (default: fpm_registry)
"""

import argparse
import os
import sys
import logging
from datetime import datetime
from typing import Optional

try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
    from bson import json_util
except ImportError:
    print("Error: pymongo is required. Install with: pip install pymongo")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


class MongoMigrator:
    """Handles MongoDB data migration between source and target databases."""
    
    def __init__(
        self,
        source_uri: str,
        target_uri: str = "mongodb://localhost:27017/",
        db_name: str = "fpm_registry",
        timeout_ms: int = 10000
    ):
        """
        Initialize the migrator with source and target MongoDB connections.
        
        Args:
            source_uri: MongoDB connection string for source database
            target_uri: MongoDB connection string for target database
            db_name: Name of the database to migrate
            timeout_ms: Connection timeout in milliseconds
        """
        self.source_uri = source_uri
        self.target_uri = target_uri
        self.db_name = db_name
        self.timeout_ms = timeout_ms
        
        self.source_client: Optional[MongoClient] = None
        self.target_client: Optional[MongoClient] = None
        
    def connect(self) -> bool:
        """
        Establish connections to both source and target MongoDB instances.
        
        Returns:
            True if both connections successful, False otherwise
        """
        try:
            # Connect to source
            logger.info(f"Connecting to source MongoDB...")
            self.source_client = MongoClient(
                self.source_uri,
                serverSelectionTimeoutMS=self.timeout_ms,
                connectTimeoutMS=self.timeout_ms
            )
            self.source_client.admin.command('ping')
            logger.info("✓ Connected to source MongoDB")
            
            # Connect to target
            logger.info(f"Connecting to target MongoDB...")
            self.target_client = MongoClient(
                self.target_uri,
                serverSelectionTimeoutMS=self.timeout_ms,
                connectTimeoutMS=self.timeout_ms
            )
            self.target_client.admin.command('ping')
            logger.info("✓ Connected to target MongoDB")
            
            return True
            
        except (ConnectionFailure, ServerSelectionTimeoutError) as e:
            logger.error(f"✗ Connection failed: {e}")
            return False
        except Exception as e:
            logger.error(f"✗ Unexpected error during connection: {e}")
            return False
    
    def disconnect(self):
        """Close MongoDB connections."""
        if self.source_client:
            self.source_client.close()
            logger.debug("Closed source MongoDB connection")
        if self.target_client:
            self.target_client.close()
            logger.debug("Closed target MongoDB connection")
    
    def get_collections(self) -> list:
        """
        Get list of collections in the source database.
        
        Returns:
            List of collection names
        """
        if not self.source_client:
            return []
        
        db = self.source_client[self.db_name]
        collections = db.list_collection_names()
        
        # Filter out system collections
        return [c for c in collections if not c.startswith('system.')]
    
    def get_collection_stats(self, collection_name: str, is_source: bool = True) -> dict:
        """
        Get statistics for a collection.
        
        Args:
            collection_name: Name of the collection
            is_source: Whether to query source (True) or target (False)
            
        Returns:
            Dictionary with collection statistics
        """
        client = self.source_client if is_source else self.target_client
        if not client:
            return {"count": 0, "size": 0}
        
        db = client[self.db_name]
        collection = db[collection_name]
        
        try:
            count = collection.count_documents({})
            stats = db.command("collstats", collection_name)
            size = stats.get("size", 0)
            return {"count": count, "size": size}
        except Exception:
            return {"count": collection.count_documents({}), "size": 0}
    
    def migrate_collection(
        self,
        collection_name: str,
        clear_target: bool = False,
        batch_size: int = 1000
    ) -> dict:
        """
        Migrate a single collection from source to target.
        
        Args:
            collection_name: Name of the collection to migrate
            clear_target: Whether to clear existing data in target
            batch_size: Number of documents to insert at a time
            
        Returns:
            Dictionary with migration statistics
        """
        if not self.source_client or not self.target_client:
            raise RuntimeError("Not connected to databases")
        
        source_db = self.source_client[self.db_name]
        target_db = self.target_client[self.db_name]
        
        source_collection = source_db[collection_name]
        target_collection = target_db[collection_name]
        
        stats = {
            "collection": collection_name,
            "source_count": 0,
            "migrated": 0,
            "skipped": 0,
            "errors": 0,
            "cleared": False
        }
        
        # Get source document count
        stats["source_count"] = source_collection.count_documents({})
        
        if stats["source_count"] == 0:
            logger.info(f"  ⚪ {collection_name}: No documents to migrate")
            return stats
        
        # Clear target if requested
        if clear_target:
            deleted = target_collection.delete_many({})
            stats["cleared"] = True
            logger.info(f"  🗑️  Cleared {deleted.deleted_count} documents from target")
        
        # Migrate documents in batches
        cursor = source_collection.find({})
        batch = []
        
        for doc in cursor:
            batch.append(doc)
            
            if len(batch) >= batch_size:
                try:
                    target_collection.insert_many(batch, ordered=False)
                    stats["migrated"] += len(batch)
                except Exception as e:
                    # Handle duplicate key errors gracefully
                    if "duplicate key" in str(e).lower():
                        stats["skipped"] += len(batch)
                    else:
                        stats["errors"] += len(batch)
                        logger.warning(f"  ⚠️  Batch insert error: {e}")
                batch = []
        
        # Insert remaining documents
        if batch:
            try:
                target_collection.insert_many(batch, ordered=False)
                stats["migrated"] += len(batch)
            except Exception as e:
                if "duplicate key" in str(e).lower():
                    stats["skipped"] += len(batch)
                else:
                    stats["errors"] += len(batch)
                    logger.warning(f"  ⚠️  Batch insert error: {e}")
        
        return stats
    
    def migrate_all(
        self,
        collections: Optional[list] = None,
        clear_target: bool = False,
        dry_run: bool = False
    ) -> dict:
        """
        Migrate all or specified collections.
        
        Args:
            collections: List of collections to migrate (None = all)
            clear_target: Whether to clear target before migrating
            dry_run: If True, only show what would be migrated
            
        Returns:
            Dictionary with overall migration statistics
        """
        if not self.connect():
            return {"success": False, "error": "Connection failed"}
        
        try:
            # Get collections to migrate
            available_collections = self.get_collections()
            
            if collections:
                # Filter to only requested collections
                to_migrate = [c for c in collections if c in available_collections]
                missing = [c for c in collections if c not in available_collections]
                if missing:
                    logger.warning(f"Collections not found in source: {missing}")
            else:
                to_migrate = available_collections
            
            if not to_migrate:
                logger.warning("No collections to migrate")
                return {"success": True, "migrated": 0, "collections": []}
            
            logger.info(f"\n{'='*60}")
            logger.info(f"Database: {self.db_name}")
            logger.info(f"Collections to migrate: {len(to_migrate)}")
            logger.info(f"{'='*60}\n")
            
            # Show migration plan
            total_docs = 0
            for coll in to_migrate:
                stats = self.get_collection_stats(coll)
                total_docs += stats["count"]
                size_mb = stats["size"] / (1024 * 1024)
                logger.info(f"  📦 {coll}: {stats['count']:,} documents ({size_mb:.2f} MB)")
            
            logger.info(f"\n  Total: {total_docs:,} documents\n")
            
            if dry_run:
                logger.info("🔍 DRY RUN - No changes will be made\n")
                return {
                    "success": True,
                    "dry_run": True,
                    "collections": to_migrate,
                    "total_documents": total_docs
                }
            
            # Perform migration
            logger.info("Starting migration...\n")
            results = []
            
            for coll in to_migrate:
                logger.info(f"Migrating {coll}...")
                result = self.migrate_collection(coll, clear_target)
                results.append(result)
                
                status = "✓" if result["errors"] == 0 else "⚠️"
                logger.info(
                    f"  {status} {coll}: {result['migrated']:,} migrated, "
                    f"{result['skipped']:,} skipped, {result['errors']:,} errors\n"
                )
            
            # Summary
            total_migrated = sum(r["migrated"] for r in results)
            total_skipped = sum(r["skipped"] for r in results)
            total_errors = sum(r["errors"] for r in results)
            
            logger.info(f"{'='*60}")
            logger.info("Migration Complete!")
            logger.info(f"  ✓ Migrated: {total_migrated:,} documents")
            logger.info(f"  ⚪ Skipped:  {total_skipped:,} documents")
            logger.info(f"  ✗ Errors:   {total_errors:,} documents")
            logger.info(f"{'='*60}\n")
            
            return {
                "success": total_errors == 0,
                "collections": results,
                "total_migrated": total_migrated,
                "total_skipped": total_skipped,
                "total_errors": total_errors
            }
            
        finally:
            self.disconnect()


def migrate_gridfs(
    source_uri: str,
    target_uri: str,
    db_name: str = "fpm_registry",
    dry_run: bool = False
) -> dict:
    """
    Migrate GridFS files (tarballs, etc.) from source to target.
    
    Args:
        source_uri: Source MongoDB URI
        target_uri: Target MongoDB URI
        db_name: Database name
        dry_run: If True, only show what would be migrated
        
    Returns:
        Dictionary with migration statistics
    """
    from gridfs import GridFS
    
    logger.info("\nMigrating GridFS files...")
    
    try:
        source_client = MongoClient(source_uri)
        target_client = MongoClient(target_uri)
        
        source_db = source_client[db_name]
        target_db = target_client[db_name]
        
        source_fs = GridFS(source_db)
        target_fs = GridFS(target_db)
        
        files = list(source_fs.find())
        logger.info(f"  Found {len(files)} GridFS files")
        
        if dry_run:
            for f in files[:10]:  # Show first 10
                logger.info(f"    📄 {f.filename} ({f.length / 1024:.1f} KB)")
            if len(files) > 10:
                logger.info(f"    ... and {len(files) - 10} more")
            return {"success": True, "dry_run": True, "file_count": len(files)}
        
        migrated = 0
        skipped = 0
        
        for source_file in files:
            # Check if file already exists in target
            if target_fs.exists({"filename": source_file.filename}):
                skipped += 1
                continue
            
            # Copy file
            target_fs.put(
                source_file.read(),
                filename=source_file.filename,
                contentType=getattr(source_file, 'contentType', 'application/octet-stream'),
                metadata=getattr(source_file, 'metadata', {})
            )
            migrated += 1
        
        logger.info(f"  ✓ Migrated: {migrated} files")
        logger.info(f"  ⚪ Skipped:  {skipped} files (already exist)")
        
        return {
            "success": True,
            "migrated": migrated,
            "skipped": skipped
        }
        
    except Exception as e:
        logger.error(f"  ✗ GridFS migration error: {e}")
        return {"success": False, "error": str(e)}
    finally:
        source_client.close()
        target_client.close()


def main():
    """Main entry point for the migration script."""
    parser = argparse.ArgumentParser(
        description="Migrate data from external MongoDB to Docker MongoDB",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    
    parser.add_argument(
        "--source-uri",
        default=os.getenv("SOURCE_MONGO_URI"),
        help="Source MongoDB connection URI (or set SOURCE_MONGO_URI env var)"
    )
    
    parser.add_argument(
        "--target-uri",
        default=os.getenv("TARGET_MONGO_URI", "mongodb://localhost:27017/"),
        help="Target MongoDB connection URI (default: mongodb://localhost:27017/)"
    )
    
    parser.add_argument(
        "--db-name",
        default=os.getenv("MONGO_DB_NAME", "fpm_registry"),
        help="Database name to migrate (default: fpm_registry)"
    )
    
    parser.add_argument(
        "--collections",
        nargs="+",
        help="Specific collections to migrate (default: all)"
    )
    
    parser.add_argument(
        "--clear-target",
        action="store_true",
        help="Clear target collections before migrating"
    )
    
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be migrated without making changes"
    )
    
    parser.add_argument(
        "--include-gridfs",
        action="store_true",
        help="Also migrate GridFS files (tarballs, etc.)"
    )
    
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging"
    )
    
    args = parser.parse_args()
    
    # Validate source URI
    if not args.source_uri:
        logger.error("Error: Source MongoDB URI is required")
        logger.error("Use --source-uri or set SOURCE_MONGO_URI environment variable")
        sys.exit(1)
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Display configuration
    logger.info("\n" + "="*60)
    logger.info("MongoDB Migration Tool")
    logger.info("="*60)
    logger.info(f"Source: {args.source_uri[:50]}...")
    logger.info(f"Target: {args.target_uri}")
    logger.info(f"Database: {args.db_name}")
    if args.collections:
        logger.info(f"Collections: {', '.join(args.collections)}")
    if args.clear_target:
        logger.info("⚠️  Clear target enabled - existing data will be deleted")
    if args.dry_run:
        logger.info("🔍 Dry run mode - no changes will be made")
    logger.info("="*60 + "\n")
    
    # Run migration
    migrator = MongoMigrator(
        source_uri=args.source_uri,
        target_uri=args.target_uri,
        db_name=args.db_name
    )
    
    result = migrator.migrate_all(
        collections=args.collections,
        clear_target=args.clear_target,
        dry_run=args.dry_run
    )
    
    # Migrate GridFS if requested
    if args.include_gridfs and not args.dry_run:
        gridfs_result = migrate_gridfs(
            args.source_uri,
            args.target_uri,
            args.db_name,
            args.dry_run
        )
        result["gridfs"] = gridfs_result
    
    # Exit with appropriate code
    sys.exit(0 if result.get("success", False) else 1)


if __name__ == "__main__":
    main()
