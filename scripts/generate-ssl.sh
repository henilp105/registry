#!/bin/bash
# Generate self-signed SSL certificates for development

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSL_DIR="$SCRIPT_DIR/../nginx/ssl"

mkdir -p "$SSL_DIR"

echo "Generating self-signed SSL certificate for development..."

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$SSL_DIR/privkey.pem" \
    -out "$SSL_DIR/fullchain.pem" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo ""
echo "✅ SSL certificates generated successfully!"
echo "   - Certificate: $SSL_DIR/fullchain.pem"
echo "   - Private Key: $SSL_DIR/privkey.pem"
echo ""
echo "You can now start the stack with: docker compose up -d"
echo ""
echo "⚠️  Note: Self-signed certificates will show a browser warning."
echo "    For production, use Let's Encrypt certificates."
