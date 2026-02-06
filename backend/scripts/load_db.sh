#!/bin/bash
#
# MongoDB Data Migration Script for Docker
#
# This script loads data from an external MongoDB database into the local
# Docker MongoDB container.
#
# Usage:
#   ./load_db.sh <source_mongodb_uri> [options]
#
# Examples:
#   # Basic migration (all collections)
#   ./load_db.sh "mongodb+srv://user:pass@cluster.mongodb.net/"
#
#   # Migrate specific collections
#   ./load_db.sh "mongodb+srv://..." --collections packages namespaces users
#
#   # Dry run to preview what would be migrated
#   ./load_db.sh "mongodb+srv://..." --dry-run
#
#   # Clear existing data before migrating
#   ./load_db.sh "mongodb+srv://..." --clear-target
#
#   # Include GridFS files (tarballs)
#   ./load_db.sh "mongodb+srv://..." --include-gridfs
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

# Default configuration
TARGET_URI="mongodb://mongo:27017/"
DB_NAME="${MONGO_DB_NAME:-fpm_registry}"
COMPOSE_FILE="$BACKEND_DIR/compose.yaml"

print_header() {
    echo -e "${BLUE}"
    echo "=============================================="
    echo "  MongoDB Data Migration Tool"
    echo "=============================================="
    echo -e "${NC}"
}

print_usage() {
    echo "Usage: $0 <source_mongodb_uri> [options]"
    echo ""
    echo "Arguments:"
    echo "  source_mongodb_uri    MongoDB connection string for source database"
    echo ""
    echo "Options:"
    echo "  --collections <list>  Migrate only specified collections"
    echo "  --clear-target        Clear target collections before migrating"
    echo "  --dry-run             Preview migration without making changes"
    echo "  --include-gridfs      Also migrate GridFS files (tarballs)"
    echo "  --db-name <name>      Database name (default: fpm_registry)"
    echo "  --help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 \"mongodb+srv://user:pass@cluster.mongodb.net/\""
    echo "  $0 \"mongodb+srv://...\" --collections packages namespaces"
    echo "  $0 \"mongodb+srv://...\" --dry-run"
    echo ""
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        echo -e "${RED}Error: Docker is not running${NC}"
        exit 1
    fi
}

check_mongo_container() {
    local container_name="backend-mongo-1"
    
    # Try alternative naming conventions
    if ! docker ps --format '{{.Names}}' | grep -q "$container_name"; then
        container_name="backend_mongo_1"
    fi
    
    if ! docker ps --format '{{.Names}}' | grep -q "mongo"; then
        echo -e "${YELLOW}Warning: MongoDB container is not running${NC}"
        echo "Starting MongoDB container..."
        
        cd "$BACKEND_DIR"
        docker compose up -d mongo
        
        # Wait for MongoDB to be ready
        echo "Waiting for MongoDB to be ready..."
        sleep 5
        
        for i in {1..30}; do
            if docker compose exec mongo mongosh --eval "db.runCommand({ping:1})" &> /dev/null; then
                echo -e "${GREEN}MongoDB is ready${NC}"
                break
            fi
            sleep 1
        done
    fi
}

run_migration() {
    local source_uri="$1"
    shift
    local extra_args="$@"
    
    echo -e "${BLUE}Running migration...${NC}"
    echo ""
    
    cd "$BACKEND_DIR"
    
    # Run the Python migration script inside a container with network access
    docker compose run --rm \
        -e SOURCE_MONGO_URI="$source_uri" \
        -e TARGET_MONGO_URI="$TARGET_URI" \
        -e MONGO_DB_NAME="$DB_NAME" \
        backend \
        python /src/scripts/migrate_db.py \
            --source-uri "$source_uri" \
            --target-uri "$TARGET_URI" \
            --db-name "$DB_NAME" \
            $extra_args
}

# Main execution
main() {
    print_header
    
    # Check for help flag
    if [[ "$1" == "--help" || "$1" == "-h" ]]; then
        print_usage
        exit 0
    fi
    
    # Check for source URI
    if [[ -z "$1" || "$1" == --* ]]; then
        echo -e "${RED}Error: Source MongoDB URI is required${NC}"
        echo ""
        print_usage
        exit 1
    fi
    
    SOURCE_URI="$1"
    shift
    
    # Parse remaining arguments
    EXTRA_ARGS=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --db-name)
                DB_NAME="$2"
                EXTRA_ARGS="$EXTRA_ARGS --db-name $2"
                shift 2
                ;;
            *)
                EXTRA_ARGS="$EXTRA_ARGS $1"
                shift
                ;;
        esac
    done
    
    # Validate environment
    check_docker
    check_mongo_container
    
    echo -e "${BLUE}Configuration:${NC}"
    echo "  Source: ${SOURCE_URI:0:50}..."
    echo "  Target: $TARGET_URI"
    echo "  Database: $DB_NAME"
    echo ""
    
    # Run the migration
    run_migration "$SOURCE_URI" $EXTRA_ARGS
    
    echo ""
    echo -e "${GREEN}Migration complete!${NC}"
}

main "$@"
