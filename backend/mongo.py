"""
MongoDB database connection and configuration.
Implements connection pooling and proper resource management.
"""
import os
import logging
from datetime import datetime
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
from dotenv import load_dotenv
from gridfs import GridFS

load_dotenv()
logger = logging.getLogger(__name__)

# ============================================================================
# Database Configuration
# ============================================================================
database_name = os.getenv("MONGO_DB_NAME", "fpm_registry")

# Connection pool settings for optimal performance
MONGO_CONFIG = {
    "maxPoolSize": int(os.getenv("MONGO_MAX_POOL_SIZE", 50)),
    "minPoolSize": int(os.getenv("MONGO_MIN_POOL_SIZE", 10)),
    "maxIdleTimeMS": 30000,  # Close idle connections after 30 seconds
    "serverSelectionTimeoutMS": 5000,  # 5 second timeout for server selection
    "connectTimeoutMS": 10000,  # 10 second connection timeout
    "socketTimeoutMS": 20000,  # 20 second socket timeout
    "retryWrites": True,
    "retryReads": True,
    "w": "majority",  # Write concern for durability
}

def create_mongo_client():
    """
    Create MongoDB client with proper connection pooling.
    """
    try:
        mongo_uri = os.getenv("MONGO_URI")
        if not mongo_uri:
            raise ValueError("MONGO_URI environment variable is required")
        
        client = MongoClient(mongo_uri, **MONGO_CONFIG)
        
        # Verify connection
        client.admin.command('ping')
        logger.info("Successfully connected to MongoDB")
        
        return client
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
        raise
    except Exception as e:
        logger.error(f"MongoDB configuration error: {e}")
        raise

try:
    client = create_mongo_client()
    db = client[database_name]
    file_storage = GridFS(db, collection="tarballs")
except Exception as e:
    logger.critical(f"Could not initialize MongoDB: {e}")
    raise

# ============================================================================
# Database Indexes for Performance
# ============================================================================
def ensure_indexes():
    """
    Create database indexes for optimal query performance.
    Call this during application startup.
    """
    try:
        # Users collection indexes
        db.users.create_index([("uuid", ASCENDING)], unique=True, sparse=True)
        db.users.create_index([("username", ASCENDING)], unique=True)
        db.users.create_index([("email", ASCENDING)], unique=True)
        db.users.create_index([("isVerified", ASCENDING)])
        
        # Packages collection indexes
        db.packages.create_index([("name", ASCENDING), ("namespace", ASCENDING)], unique=True)
        db.packages.create_index([("namespace_name", ASCENDING)])
        db.packages.create_index([("author", ASCENDING)])
        db.packages.create_index([("is_deprecated", ASCENDING)])
        db.packages.create_index([("updated_at", DESCENDING)])
        db.packages.create_index([("created_at", DESCENDING)])
        # Text index for search
        db.packages.create_index([
            ("name", "text"),
            ("description", "text"),
            ("registry_description", "text"),
            ("keywords", "text"),
            ("categories", "text")
        ], weights={
            "name": 10,
            "keywords": 5,
            "categories": 5,
            "description": 3,
            "registry_description": 1
        })
        
        # Namespaces collection indexes
        db.namespaces.create_index([("namespace", ASCENDING)], unique=True)
        db.namespaces.create_index([("author", ASCENDING)])
        db.namespaces.create_index([("admins", ASCENDING)])
        db.namespaces.create_index([("maintainers", ASCENDING)])
        db.namespaces.create_index([("upload_tokens.token", ASCENDING)], sparse=True)
        
        # Tarballs GridFS indexes
        db.tarballs.files.create_index([("metadata.url", ASCENDING)])
        
        logger.info("Database indexes created successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to create indexes: {e}")
        return False

# ============================================================================
# Database Health Check
# ============================================================================
def check_database_health():
    """
    Check if database connection is healthy.
    Returns tuple of (is_healthy, latency_ms, error_message)
    """
    try:
        start = datetime.utcnow()
        client.admin.command('ping')
        latency = (datetime.utcnow() - start).total_seconds() * 1000
        return True, latency, None
    except Exception as e:
        return False, 0, str(e)

# ============================================================================
# Logging Handler
# ============================================================================
class MongoDBHandler(logging.Handler):
    """Custom logging handler that stores logs in MongoDB."""
    
    def __init__(self, collection):
        super().__init__()
        self.collection = collection
        self._buffer = []
        self._buffer_size = 10  # Batch insert for better performance

    def emit(self, record):
        try:
            log_document = {
                "timestamp": datetime.utcnow(),
                "level": record.levelname,
                "message": self.format(record),
                "module": record.module,
                "funcName": record.funcName,
                "lineno": record.lineno
            }
            self._buffer.append(log_document)
            
            # Flush buffer when it reaches the limit
            if len(self._buffer) >= self._buffer_size:
                self._flush_buffer()
        except Exception:
            self.handleError(record)
    
    def _flush_buffer(self):
        """Insert buffered logs into MongoDB."""
        if self._buffer:
            try:
                self.collection.insert_many(self._buffer)
                self._buffer = []
            except Exception as e:
                logger.error(f"Failed to flush log buffer: {e}")
    
    def close(self):
        """Flush remaining logs before closing."""
        self._flush_buffer()
        super().close()

# Create the MongoDB logging handler (only for ERROR and above)
try:
    mongo_handler = MongoDBHandler(collection=db.logs)
    mongo_handler.setLevel(logging.ERROR)
    logging.root.addHandler(mongo_handler)
except Exception as e:
    logger.warning(f"Could not set up MongoDB logging: {e}")

# ============================================================================
# Database Query Helpers
# ============================================================================
def find_one_or_none(collection, query, projection=None):
    """
    Find a single document or return None.
    Wrapper for consistent null handling.
    """
    return collection.find_one(query, projection)

def count_documents_fast(collection, query):
    """
    Fast document count using estimated count when possible.
    """
    if query == {}:
        return collection.estimated_document_count()
    return collection.count_documents(query)
