# Getting Started

This guide will help you get up and running with the FPM Registry, whether you're a package consumer looking to use packages, or a package author wanting to publish your work.

## For Package Users

### Prerequisites

1. **Install fpm** (Fortran Package Manager):
   ```bash
   # Using conda
   conda install -c conda-forge fpm

   # Using Homebrew (macOS)
   brew install fpm

   # From source
   git clone https://github.com/fortran-lang/fpm
   cd fpm
   ./install.sh
   ```

2. **Verify installation**:
   ```bash
   fpm --version
   ```

### Using Packages from the Registry

#### Searching for Packages

Browse packages through the web interface at [https://registry.fortran-lang.org](https://registry.fortran-lang.org) or use the API:

```bash
# Search for packages
curl "https://registry.fortran-lang.org/api/packages?query=json"

# Get package details
curl "https://registry.fortran-lang.org/api/packages/fortran-lang/json-fortran"
```

#### Adding Dependencies

Add registry packages to your `fpm.toml`:

```toml
[dependencies]
json-fortran = { namespace = "fortran-lang", version = "0.1.0" }
stdlib = { namespace = "fortran-lang" }
```

#### Building Your Project

```bash
fpm build
fpm run
fpm test
```

---

## For Package Authors

### Creating an Account

1. **Sign up** at the registry website or via API:
   ```bash
   curl -X POST "https://registry.fortran-lang.org/api/auth/signup" \
     -H "Content-Type: application/json" \
     -d '{
       "username": "your-username",
       "email": "your-email@example.com",
       "password": "your-secure-password"
     }'
   ```

2. **Verify your email** by clicking the link sent to your inbox.

3. **Login** to get your authentication token:
   ```bash
   curl -X POST "https://registry.fortran-lang.org/api/auth/login" \
     -H "Content-Type: application/json" \
     -d '{
       "email": "your-email@example.com",
       "password": "your-secure-password"
     }'
   ```

   Save the returned JWT token for authenticated requests.

### Creating a Namespace

Namespaces organize packages under a common identifier (like an organization or username):

```bash
curl -X POST "https://registry.fortran-lang.org/api/namespaces" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "namespace_description": "My Fortran packages"
  }'
```

### Preparing Your Package

Ensure your package has a valid `fpm.toml`:

```toml
name = "my-package"
version = "0.1.0"
license = "MIT"
author = "Your Name"
maintainer = "your-email@example.com"
copyright = "Copyright 2026, Your Name"

[build]
auto-executables = true
auto-tests = true

[library]
source-dir = "src"
```

### Publishing a Package

1. **Generate an upload token**:
   ```bash
   curl -X POST "https://registry.fortran-lang.org/api/namespaces/my-namespace/uploadToken" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

2. **Upload your package** (using fpm):
   ```bash
   fpm publish --token YOUR_UPLOAD_TOKEN
   ```

   Or manually via API:
   ```bash
   tar -czvf my-package-0.1.0.tar.gz .
   
   curl -X POST "https://registry.fortran-lang.org/api/packages" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -F "tarball=@my-package-0.1.0.tar.gz" \
     -F "namespace=my-namespace"
   ```

---

## Quick Start with Docker

For local development or self-hosting:

```bash
# Clone the repository
git clone https://github.com/fortran-lang/fpm-registry
cd fpm-registry/registry

# Start all services
docker compose up -d

# Access the registry
open http://localhost

# View logs
docker compose logs -f

# Stop services
docker compose down
```

### Environment Configuration

Create a `.env` file for custom configuration:

```bash
# MongoDB
MONGO_DB_NAME=fpmregistry

# Security (CHANGE IN PRODUCTION!)
SALT=your-unique-salt-value
JWT_SECRET_KEY=your-jwt-secret-key

# Email (optional, for password reset)
RESET_EMAIL=your-email@gmail.com
RESET_PASSWORD=your-app-password

# Admin password
SUDO_PASSWORD=your-admin-password
```

---

## Next Steps

- [API Reference](api-reference.md) - Complete API documentation
- [Authentication](authentication.md) - Deep dive into auth flows
- [Package Management](package-management.md) - Advanced publishing options
- [Deployment Guide](deployment.md) - Production deployment

---

## Troubleshooting

### Common Issues

**Q: My package upload fails with "namespace not found"**

A: Ensure you've created the namespace first and have admin/maintainer permissions.

**Q: JWT token is rejected**

A: Tokens expire after 90 days. Login again to get a fresh token.

**Q: Package not appearing in search**

A: New packages undergo verification. Check the package status via API.

### Getting Help

- Check the [FAQ](faq.md) for common questions
- Search existing [GitHub Issues](https://github.com/fortran-lang/fpm-registry/issues)
- Ask on [Fortran Discourse](https://fortran-lang.discourse.group/)
