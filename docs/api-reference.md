# API Reference

Complete REST API documentation for the FPM Registry. All endpoints use JSON for request and response bodies unless otherwise specified.

## Base URL

```
Production: https://registry.fortran-lang.org/api
Development: http://localhost/api
```

## Response Format

All responses follow a consistent format:

```json
{
  "code": 200,
  "message": "Success message",
  "data": { }
}
```

### Error Response

```json
{
  "code": 400,
  "error": "error_type",
  "message": "Human-readable error description"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid or missing token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 500 | Internal Server Error |

---

## Health & Status

### GET /

Get API information and health status.

**Response:**
```json
{
  "code": 200,
  "message": "FPM Registry API",
  "status": "healthy",
  "version": "2.0.1"
}
```

### GET /health

Detailed health check including database connectivity.

**Response:**
```json
{
  "code": 200,
  "status": "healthy",
  "database": "connected",
  "version": "2.0.1"
}
```

### GET /latency

Performance testing endpoint. Measures response times across all API endpoints.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| category | string | Filter by category: `health`, `packages`, `namespaces`, `users`, `database` |

**Response:**
```json
{
  "code": 200,
  "message": "Latency test completed",
  "total_endpoints": 10,
  "successful": 10,
  "failed": 0,
  "avg_latency_ms": 2.5,
  "min_latency_ms": 0.5,
  "max_latency_ms": 5.0,
  "results": [
    {
      "endpoint": "/packages",
      "method": "GET",
      "status_code": 200,
      "latency_ms": 2.5,
      "success": true,
      "category": "packages"
    }
  ]
}
```

---

## Authentication

All authenticated endpoints require the `Authorization` header:

```
Authorization: Bearer <JWT_TOKEN>
```

### POST /auth/signup

Create a new user account.

**Request Body:**
```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

**Response (201):**
```json
{
  "code": 201,
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### POST /auth/login

Authenticate and receive a JWT token.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "code": 200,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "username": "john_doe",
    "email": "john@example.com"
  }
}
```

### POST /auth/logout

Invalidate the current session.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "code": 200,
  "message": "Logged out successfully"
}
```

### POST /auth/forgot-password

Request a password reset email.

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Response (200):**
```json
{
  "code": 200,
  "message": "Password reset email sent"
}
```

### POST /auth/reset-password

Reset password using token from email.

**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "new_password": "NewSecurePassword456!"
}
```

### POST /auth/verify-email

Verify email address using verification token.

**Request Body:**
```json
{
  "token": "email-verification-token"
}
```

---

## Packages

### GET /packages

List and search packages with pagination.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| query | string | - | Search term |
| page | integer | 1 | Page number |
| limit | integer | 10 | Results per page |
| sorted_by | string | name | Sort field: `name`, `date`, `downloads` |
| sort | string | asc | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "code": 200,
  "packages": [
    {
      "name": "json-fortran",
      "namespace": "fortran-lang",
      "description": "JSON library for Fortran",
      "version": "1.2.0",
      "downloads": 1500,
      "author": "jacobwilliams",
      "license": "MIT",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-06-20T14:22:00Z"
    }
  ],
  "total_pages": 5
}
```

### GET /packages_cli

Package search optimized for CLI tools.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| query | string | Search term (default: "fortran") |
| namespace | string | Filter by namespace |
| package | string | Filter by package name |
| license | string | Filter by license |
| page | integer | Page number |
| limit | integer | Results per page |

### POST /packages

Upload a new package version. Requires authentication.

**Headers:** `Authorization: Bearer <token>`

**Request:** `multipart/form-data`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tarball | file | Yes | Package tarball (.tar.gz) |
| namespace | string | Yes | Target namespace |

**Response (201):**
```json
{
  "code": 201,
  "message": "Package uploaded successfully",
  "package": {
    "name": "my-package",
    "namespace": "my-namespace",
    "version": "1.0.0"
  }
}
```

### GET /packages/:namespace/:package

Get detailed package information.

**Response:**
```json
{
  "code": 200,
  "package": {
    "name": "json-fortran",
    "namespace": "fortran-lang",
    "description": "JSON library for Fortran",
    "repository": "https://github.com/jacobwilliams/json-fortran",
    "homepage": "https://json-fortran.github.io",
    "license": "MIT",
    "author": "jacobwilliams",
    "maintainers": ["jacobwilliams", "fortran-lang"],
    "keywords": ["json", "parsing", "serialization"],
    "categories": ["data-formats"],
    "versions": [
      {
        "version": "1.2.0",
        "created_at": "2024-06-20T14:22:00Z",
        "is_verified": true
      },
      {
        "version": "1.1.0",
        "created_at": "2024-03-10T09:15:00Z",
        "is_verified": true
      }
    ],
    "downloads": 1500,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### GET /packages/:namespace/:package/:version

Get specific version details.

**Response:**
```json
{
  "code": 200,
  "version": {
    "version": "1.2.0",
    "created_at": "2024-06-20T14:22:00Z",
    "is_verified": true,
    "tarball_url": "/tarballs/64a1b2c3d4e5f6..."
  }
}
```

### POST /packages/:namespace/:package/delete

Delete a package. Requires admin permissions.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "password": "admin-password"
}
```

### POST /packages/:namespace/:package/:version/delete

Delete a specific version.

**Headers:** `Authorization: Bearer <token>`

### GET /packages/:namespace/:package/maintainers

Get package maintainers.

**Response:**
```json
{
  "code": 200,
  "maintainers": ["user1", "user2"]
}
```

### POST /packages/:namespace/:package/uploadToken

Generate an upload token for this package.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "code": 200,
  "upload_token": "pkg_upload_token_xxx"
}
```

### GET /tarballs/:oid

Download a package tarball by its object ID.

**Response:** Binary tarball file (application/gzip)

---

## Namespaces

### POST /namespaces

Create a new namespace.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "namespace": "my-org",
  "namespace_description": "My organization's packages"
}
```

**Response (201):**
```json
{
  "code": 201,
  "message": "Namespace created successfully",
  "namespace": "my-org"
}
```

### GET /namespace/:namespace

Get namespace details and packages.

**Response:**
```json
{
  "code": 200,
  "namespace": {
    "namespace": "fortran-lang",
    "description": "Official Fortran-lang packages",
    "admins": ["fortran-admin"],
    "maintainers": ["contributor1", "contributor2"],
    "packages": ["stdlib", "fpm", "json-fortran"],
    "created_at": "2023-01-01T00:00:00Z"
  }
}
```

### POST /namespace/:namespace/delete

Delete a namespace. Requires admin permissions.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "password": "admin-password"
}
```

### POST /namespaces/:namespace/uploadToken

Generate an upload token for the namespace.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "code": 200,
  "upload_token": "ns_upload_token_xxx"
}
```

### POST /namespaces/:namespace/admins

Get namespace administrators.

**Headers:** `Authorization: Bearer <token>`

### POST /namespaces/:namespace/maintainers

Get namespace maintainers.

**Headers:** `Authorization: Bearer <token>`

---

## Users

### GET /users/:username

Get public user profile.

**Response:**
```json
{
  "code": 200,
  "user": {
    "username": "john_doe",
    "packages": ["package1", "package2"],
    "namespaces": ["my-namespace"],
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### POST /users/account

Get authenticated user's account details.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "code": 200,
  "user": {
    "username": "john_doe",
    "email": "john@example.com",
    "namespaces": ["my-namespace"],
    "packages": ["package1"],
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### POST /users/delete

Delete the authenticated user's account.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "password": "current-password"
}
```

### POST /users/admin

Verify admin privileges.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "password": "sudo-password"
}
```

---

## Maintainer Management

### POST /:username/maintainer

Add a package maintainer.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "namespace": "my-namespace",
  "package": "my-package",
  "new_maintainer": "contributor-username"
}
```

### POST /:username/maintainer/remove

Remove a package maintainer.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "namespace": "my-namespace",
  "package": "my-package",
  "maintainer": "contributor-username"
}
```

### POST /:username/namespace/maintainer

Add a namespace maintainer.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "namespace": "my-namespace",
  "new_maintainer": "contributor-username"
}
```

### POST /:username/namespace/maintainer/remove

Remove a namespace maintainer.

**Headers:** `Authorization: Bearer <token>`

### POST /:username/namespace/admin

Add a namespace administrator.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "namespace": "my-namespace",
  "new_admin": "admin-username"
}
```

### POST /:username/namespace/admin/remove

Remove a namespace administrator.

**Headers:** `Authorization: Bearer <token>`

---

## Ratings & Reports

### POST /ratings/:namespace/:package

Rate a package (1-5 stars).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "rating": 5
}
```

### POST /report/:namespace/:package

Report a malicious or problematic package.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "reason": "Description of the issue"
}
```

### GET /report/view

View all package reports. Admin only.

**Headers:** `Authorization: Bearer <token>`

---

## Rate Limiting

API requests are rate limited to prevent abuse:

| Endpoint Type | Limit |
|--------------|-------|
| Authentication | 10 requests/minute |
| Package Upload | 5 uploads/hour |
| General API | 100 requests/minute |

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1612345678
```

---

## Interactive Documentation

For interactive API exploration, visit the Swagger UI at:
- **Production:** https://registry.fortran-lang.org/apidocs
- **Development:** http://localhost/api/apidocs
