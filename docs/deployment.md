# Deployment Guide

This guide covers deploying the FPM Registry in various environments, from development to production.

## Architecture Overview

```
                                    ┌─────────────────┐
                                    │   Load Balancer │
                                    │    (Optional)   │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
           ┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
           │   Nginx Proxy   │     │   Nginx Proxy   │     │   Nginx Proxy   │
           │   (Frontend)    │     │   (Frontend)    │     │   (Frontend)    │
           └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
                    │                        │                        │
           ┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
           │  Flask Backend  │     │  Flask Backend  │     │  Flask Backend  │
           │    (Gunicorn)   │     │    (Gunicorn)   │     │    (Gunicorn)   │
           └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
                    │                        │                        │
                    └────────────────────────┼────────────────────────┘
                                             │
                                    ┌────────▼────────┐
                                    │    MongoDB      │
                                    │   (Database)    │
                                    └─────────────────┘
```

### Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | React + Nginx | User interface |
| Backend API | Flask + Gunicorn | REST API |
| Database | MongoDB | Data persistence |
| Reverse Proxy | Nginx | SSL, routing, static files |
| Package Storage | File system / S3 | Tarball storage |

---

## Quick Start with Docker

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- 2GB RAM minimum
- 10GB disk space

### Development Deployment

```bash
# Clone repository
git clone https://github.com/fortran-lang/registry.git
cd registry/backend

# Start services
docker compose up -d

# View logs
docker compose logs -f
```

**Services started:**
- Backend API: `http://localhost:5000`
- MongoDB: `localhost:27017`

### Production Deployment

```bash
# Use production compose file
docker compose -f compose.yaml up -d

# Or with custom environment
docker compose --env-file .env.production up -d
```

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `JWT_SECRET_KEY` | Secret for JWT signing | `your-256-bit-secret` |
| `FLASK_ENV` | Environment mode | `production` |

### Email Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `MAIL_SERVER` | SMTP server | `smtp.gmail.com` |
| `MAIL_PORT` | SMTP port | `587` |
| `MAIL_USE_TLS` | Use TLS | `true` |
| `MAIL_USERNAME` | SMTP username | `registry@fortran-lang.org` |
| `MAIL_PASSWORD` | SMTP password | `app-password` |
| `SENDER_EMAIL` | From address | `noreply@fortran-lang.org` |

### Security Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SECRET_KEY` | Flask secret key | `random-32-char-string` |
| `JWT_ACCESS_TOKEN_EXPIRES` | Token expiry (seconds) | `3600` |
| `UPLOAD_TOKEN_EXPIRES` | Upload token expiry | `2592000` |
| `SUDO_PASSWORD` | Admin actions password | `strong-password` |

### Storage Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `UPLOAD_FOLDER` | Tarball storage path | `/var/registry/packages` |
| `MAX_CONTENT_LENGTH` | Max upload size (bytes) | `52428800` |
| `STATIC_FOLDER` | Static files path | `/var/registry/static` |

### Complete `.env` Example

```bash
# .env.production
FLASK_ENV=production
DEBUG=false

# MongoDB
MONGO_URI=mongodb://mongo:27017/fpm_registry

# Security
SECRET_KEY=your-super-secret-key-change-in-production
JWT_SECRET_KEY=another-secret-key-for-jwt-tokens
SUDO_PASSWORD=admin-password-for-dangerous-operations

# Token Expiration
JWT_ACCESS_TOKEN_EXPIRES=3600
UPLOAD_TOKEN_EXPIRES=2592000

# Email
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=registry@fortran-lang.org
MAIL_PASSWORD=your-app-password
SENDER_EMAIL=noreply@fortran-lang.org

# Storage
UPLOAD_FOLDER=/app/static/packages
MAX_CONTENT_LENGTH=52428800
```

---

## Docker Configuration

### Backend Dockerfile

```dockerfile
# docker/backend.Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    gfortran \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create upload directory
RUN mkdir -p /app/static/packages

# Run with gunicorn
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]
```

### Docker Compose

```yaml
# compose.yaml
version: '3.8'

services:
  backend:
    build:
      context: .
      dockerfile: docker/backend.Dockerfile
    ports:
      - "5000:5000"
    environment:
      - MONGO_URI=mongodb://mongo:27017/fpm_registry
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - FLASK_ENV=production
    volumes:
      - package_storage:/app/static/packages
    depends_on:
      - mongo
    restart: unless-stopped

  mongo:
    image: mongo:6.0
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./frontend/build:/usr/share/nginx/html:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  mongo_data:
  package_storage:
```

---

## Nginx Configuration

### Basic Configuration

```nginx
# nginx/nginx.conf
worker_processes auto;
events {
    worker_connections 1024;
}

http {
    include mime.types;
    default_type application/octet-stream;

    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 50M;

    # Gzip compression
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;

    upstream backend {
        server backend:5000;
    }

    server {
        listen 80;
        server_name registry.fortran-lang.org;
        
        # Redirect HTTP to HTTPS
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name registry.fortran-lang.org;

        # SSL certificates
        ssl_certificate /etc/letsencrypt/live/registry.fortran-lang.org/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/registry.fortran-lang.org/privkey.pem;

        # SSL settings
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        ssl_prefer_server_ciphers off;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Strict-Transport-Security "max-age=31536000" always;

        # Frontend
        location / {
            root /usr/share/nginx/html;
            try_files $uri $uri/ /index.html;
        }

        # API proxy
        location /api/ {
            proxy_pass http://backend/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Timeout settings
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # Package downloads
        location /packages/ {
            alias /var/registry/packages/;
            expires 7d;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

---

## MongoDB Configuration

### Standalone Setup

```yaml
# mongo-init.js
db = db.getSiblingDB('fpm_registry');

// Create indexes
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "username": 1 }, { unique: true });
db.packages.createIndex({ "name": 1, "namespace": 1 }, { unique: true });
db.packages.createIndex({ "name": "text", "description": "text" });
db.namespaces.createIndex({ "namespace": 1 }, { unique: true });

// Create admin user (optional)
db.createUser({
    user: "registry_admin",
    pwd: "secure_password",
    roles: [
        { role: "readWrite", db: "fpm_registry" }
    ]
});
```

### Replica Set (Production)

```yaml
# compose.mongo-replica.yaml
version: '3.8'

services:
  mongo1:
    image: mongo:6.0
    command: mongod --replSet rs0 --bind_ip_all
    volumes:
      - mongo1_data:/data/db
    ports:
      - "27017:27017"

  mongo2:
    image: mongo:6.0
    command: mongod --replSet rs0 --bind_ip_all
    volumes:
      - mongo2_data:/data/db

  mongo3:
    image: mongo:6.0
    command: mongod --replSet rs0 --bind_ip_all
    volumes:
      - mongo3_data:/data/db

volumes:
  mongo1_data:
  mongo2_data:
  mongo3_data:
```

Initialize replica set:
```bash
docker exec -it mongo1 mongosh --eval '
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongo1:27017" },
    { _id: 1, host: "mongo2:27017" },
    { _id: 2, host: "mongo3:27017" }
  ]
})'
```

---

## SSL/TLS Setup

### Let's Encrypt with Certbot

```bash
# Install certbot
apt-get install certbot python3-certbot-nginx

# Obtain certificate
certbot certonly --webroot \
  -w /var/www/certbot \
  -d registry.fortran-lang.org \
  -m admin@fortran-lang.org \
  --agree-tos

# Auto-renewal (cron)
0 0 1 * * certbot renew --quiet
```

### Self-Signed (Development)

```bash
# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/registry.key \
  -out /etc/ssl/certs/registry.crt \
  -subj "/CN=localhost"
```

---

## Scaling

### Horizontal Scaling

```yaml
# compose.scale.yaml
version: '3.8'

services:
  backend:
    build: .
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '1'
          memory: 512M
    environment:
      - MONGO_URI=mongodb://mongo1:27017,mongo2:27017,mongo3:27017/fpm_registry?replicaSet=rs0

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    depends_on:
      - backend
```

Scale backends:
```bash
docker compose up -d --scale backend=5
```

### Load Balancer Configuration

```nginx
upstream backend {
    least_conn;
    server backend1:5000 weight=3;
    server backend2:5000 weight=3;
    server backend3:5000 weight=3;
    keepalive 32;
}
```

---

## Monitoring

### Health Check Endpoint

```bash
curl http://localhost:5000/health
```

```json
{
  "status": "healthy",
  "version": "2.0.0",
  "database": "connected",
  "uptime": 86400
}
```

### Docker Health Checks

```yaml
services:
  backend:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

### Logging

```yaml
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
```

View logs:
```bash
docker compose logs -f backend
docker compose logs --since 1h backend
```

---

## Backup and Recovery

### MongoDB Backup

```bash
# Create backup
docker exec mongo mongodump \
  --db fpm_registry \
  --out /backup/$(date +%Y%m%d)

# Copy to host
docker cp mongo:/backup ./backups/
```

### Automated Backups

```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/var/backups/registry

# Backup MongoDB
docker exec mongo mongodump --db fpm_registry --archive=/tmp/backup.gz --gzip
docker cp mongo:/tmp/backup.gz $BACKUP_DIR/mongo_$DATE.gz

# Backup packages
tar -czf $BACKUP_DIR/packages_$DATE.tar.gz /var/registry/packages

# Cleanup old backups (keep 7 days)
find $BACKUP_DIR -mtime +7 -delete
```

### Restore

```bash
# Restore MongoDB
docker cp ./backups/mongo_20240115.gz mongo:/tmp/
docker exec mongo mongorestore --archive=/tmp/mongo_20240115.gz --gzip

# Restore packages
tar -xzf ./backups/packages_20240115.tar.gz -C /
```

---

## Security Hardening

### Firewall Rules

```bash
# Allow only necessary ports
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
```

### Docker Security

```yaml
services:
  backend:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    user: "1000:1000"
```

### MongoDB Security

```yaml
services:
  mongo:
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}
    command: mongod --auth
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs backend

# Check container status
docker compose ps

# Inspect container
docker inspect registry-backend-1
```

### Database Connection Issues

```bash
# Test MongoDB connection
docker exec mongo mongosh --eval "db.adminCommand('ping')"

# Check network
docker network inspect registry_default
```

### Performance Issues

```bash
# Check resource usage
docker stats

# Check MongoDB slow queries
docker exec mongo mongosh --eval "db.currentOp({secs_running: {$gte: 5}})"
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All environment variables configured
- [ ] SSL certificates obtained
- [ ] MongoDB indexes created
- [ ] Firewall rules configured
- [ ] Backup strategy implemented

### Deployment

- [ ] Pull latest images
- [ ] Run database migrations
- [ ] Start services
- [ ] Verify health checks pass
- [ ] Test critical endpoints

### Post-Deployment

- [ ] Monitor logs for errors
- [ ] Check response times
- [ ] Verify backup jobs running
- [ ] Update documentation

---

## Next Steps

- [Contributing Guide](contributing.md) - Development setup
- [API Reference](api-reference.md) - API documentation
- [Authentication](authentication.md) - Security configuration
