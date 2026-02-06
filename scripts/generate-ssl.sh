#!/bin/bash
# Generate self-signed SSL certificates for development/production
# Usage: ./generate-ssl.sh [hostname_or_ip]
# Example: ./generate-ssl.sh 64.226.81.128
#          ./generate-ssl.sh registry.example.com

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."

# SSL directories - generate for both nginx locations
SSL_DIRS=(
    "$REPO_ROOT/nginx/ssl"
    "$REPO_ROOT/backend/nginx/ssl"
)

# Default hostname/IP
HOST="${1:-localhost}"

echo "=============================================="
echo "  SSL Certificate Generator"
echo "=============================================="
echo ""
echo "Host: $HOST"
echo ""

# Build Subject Alternative Names
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    # It's an IP address
    SAN="IP:$HOST,IP:127.0.0.1,DNS:localhost"
    echo "Detected IP address, using IP SAN"
else
    # It's a hostname
    SAN="DNS:$HOST,DNS:localhost,IP:127.0.0.1"
    echo "Detected hostname, using DNS SAN"
fi

echo ""

for SSL_DIR in "${SSL_DIRS[@]}"; do
    mkdir -p "$SSL_DIR"
    
    echo "Generating certificates in: $SSL_DIR"
    
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$SSL_DIR/privkey.pem" \
        -out "$SSL_DIR/fullchain.pem" \
        -subj "/CN=$HOST/O=FPM Registry/C=US" \
        -addext "subjectAltName=$SAN" \
        2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "  ✅ Certificate: $SSL_DIR/fullchain.pem"
        echo "  ✅ Private Key: $SSL_DIR/privkey.pem"
    else
        echo "  ❌ Failed to generate certificates in $SSL_DIR"
    fi
    echo ""
done

echo "=============================================="
echo "  ✅ SSL certificates generated successfully!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "  1. Start the stack:  docker compose up -d"
echo "  2. Or for backend:   cd backend && docker compose up -d"
echo ""
echo "⚠️  Note: Self-signed certificates will show a browser warning."
echo "    For production with a domain, use Let's Encrypt:"
echo "    docker compose --profile certbot up -d"
echo ""
