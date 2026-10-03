# Authentication

The FPM Registry uses JSON Web Tokens (JWT) for authentication. This guide covers all aspects of the authentication system, security best practices, and common workflows.

## Overview

The authentication flow consists of:

1. **Registration** - Create an account with email verification
2. **Login** - Authenticate and receive a JWT token
3. **Token Usage** - Include token in API requests
4. **Token Refresh** - Obtain new tokens before expiration

## JWT Token Structure

Tokens are issued in the standard JWT format:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyX2lkIiwiZXhwIjoxNjE...
```

### Token Payload

```json
{
  "sub": "user_id",
  "iat": 1612345678,
  "exp": 1620121678,
  "type": "access"
}
```

### Token Expiration

| Token Type | Default Expiration |
|-----------|-------------------|
| Access Token | 90 days |
| Refresh Token | 180 days |

The defaults are baked into the Worker (`worker/src/routes/auth.ts`);
they are not currently configurable via environment variables.

---

## Authentication Flows

### Registration Flow

```mermaid
sequenceDiagram
    participant User
    participant API
    participant DB
    participant Email

    User->>API: POST /auth/signup
    API->>DB: Check email uniqueness
    DB-->>API: Email available
    API->>DB: Create user (unverified)
    API->>Email: Send verification email
    API-->>User: 201 Created + JWT Token
    User->>API: POST /auth/verify-email
    API->>DB: Mark email verified
    API-->>User: 200 Email verified
```

#### Step 1: Sign Up

```bash
curl -X POST "https://registry.fortran-lang.org/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "fortran_dev",
    "email": "developer@example.com",
    "password": "SecureP@ssw0rd!"
  }'
```

**Password Requirements:**
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter  
- At least one number
- At least one special character

**Response:** `200 OK` — no tokens are issued until the email is verified:
```json
{
  "message": "Signup successful. Please verify your email."
}
```

#### Step 2: Verify Email

Click the link in your verification email, or use the API:

```bash
curl -X POST "https://registry.fortran-lang.org/api/auth/verify-email" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "uuid=verification-token-from-email"
```

On success the response also issues a fresh token pair:
```json
{
  "message": "Successfully Verified Email",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Login Flow

```bash
curl -X POST "https://registry.fortran-lang.org/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "developer@example.com",
    "password": "SecureP@ssw0rd!"
  }'
```

**Response:**
```json
{
  "message": "Login successful",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "username": "fortran_dev"
}
```

### Using the Token

Include the token in the `Authorization` header for authenticated requests:

```bash
curl "https://registry.fortran-lang.org/api/users/account" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Password Management

### Forgot Password

Request a password reset email:

```bash
curl -X POST "https://registry.fortran-lang.org/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "developer@example.com"
  }'
```

**Response:**
```json
{
  "code": 200,
  "message": "If an account exists with this email, a reset link has been sent."
}
```

> **Note:** The response is intentionally vague to prevent email enumeration attacks.

### Reset Password

Use the token from the reset email:

```bash
```bash
curl -X POST "https://registry.fortran-lang.org/api/auth/reset-password" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "uuid=reset-token-from-email&password=NewSecureP@ssw0rd!"
```

A signed-in user changing their own password instead sends
`oldpassword` + `password` with a `Bearer` header (HTTP 200 on success).

### Change Email

Authenticated users can change their email:

```bash
curl -X POST "https://registry.fortran-lang.org/api/auth/change-email" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "new_email=new-email@example.com"
```

No current-password field is required; the change is confirmed by a link sent
to the *new* address.

---

## Authorization Levels

The registry uses role-based access control (RBAC):

### Permission Hierarchy

```
Super Admin (sudo)
    │
    ├── Namespace Admin
    │       │
    │       └── Namespace Maintainer
    │               │
    │               └── Package Maintainer
    │
    └── Regular User
```

### Role Capabilities

| Action | User | Pkg Maintainer | NS Maintainer | NS Admin | Sudo |
|--------|:----:|:--------------:|:-------------:|:--------:|:----:|
| View packages | ✓ | ✓ | ✓ | ✓ | ✓ |
| Upload to package | ✗ | ✓ | ✓ | ✓ | ✓ |
| Upload to namespace | ✗ | ✗ | ✓ | ✓ | ✓ |
| Add pkg maintainers | ✗ | ✓ | ✓ | ✓ | ✓ |
| Add ns maintainers | ✗ | ✗ | ✗ | ✓ | ✓ |
| Delete namespace | ✗ | ✗ | ✗ | ✓ | ✓ |
| View reports | ✗ | ✗ | ✗ | ✗ | ✓ |
| Delete any package | ✗ | ✗ | ✗ | ✗ | ✓ |

### Admin Verification

Some operations require sudo/admin verification:

```bash
curl -X POST "https://registry.fortran-lang.org/api/users/admin" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "password": "SUDO_PASSWORD"
  }'
```

---

## Upload Tokens

For automated package uploads (CI/CD), use upload tokens instead of JWT:

### Generate Namespace Upload Token

```bash
curl -X POST "https://registry.fortran-lang.org/api/namespaces/my-namespace/uploadToken" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "code": 200,
  "upload_token": "fpm_upload_ns_abc123xyz..."
}
```

### Generate Package Upload Token

```bash
curl -X POST "https://registry.fortran-lang.org/api/packages/my-namespace/my-package/uploadToken" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Using Upload Tokens

```bash
fpm publish --token "fpm_upload_ns_abc123xyz..."
```

Or via API:
```bash
curl -X POST "https://registry.fortran-lang.org/api/packages" \
  -H "Authorization: Bearer fpm_upload_ns_abc123xyz..." \
  -F "tarball=@my-package-1.0.0.tar.gz" \
  -F "namespace=my-namespace"
```

---

## Security Best Practices

### Token Storage

**DO:**
- Store tokens in secure, encrypted storage
- Use environment variables for scripts
- Use credential managers or keychains

**DON'T:**
- Commit tokens to version control
- Store tokens in plain text files
- Share tokens between users
- Log tokens in application logs

### Example: Secure Token Storage

```bash
# Store in environment variable
export FPM_REGISTRY_TOKEN="your-token-here"

# Use in scripts
curl -H "Authorization: Bearer $FPM_REGISTRY_TOKEN" ...
```

### Token Rotation

Regularly rotate your tokens:

1. Login to get a new token
2. Update your stored token
3. Old tokens remain valid until expiration

### CI/CD Security

For GitHub Actions:

```yaml
# .github/workflows/publish.yml
name: Publish Package

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup fpm
        uses: fortran-lang/setup-fpm@v5
        
      - name: Publish to Registry
        env:
          FPM_UPLOAD_TOKEN: ${{ secrets.FPM_UPLOAD_TOKEN }}
        run: fpm publish --token "$FPM_UPLOAD_TOKEN"
```

Store `FPM_UPLOAD_TOKEN` in GitHub Secrets.

---

## Error Handling

### Common Authentication Errors

| Error | Code | Description | Solution |
|-------|------|-------------|----------|
| `token_expired` | 401 | JWT has expired | Login again to get new token |
| `invalid_token` | 401 | Token is malformed | Check token format |
| `missing_token` | 401 | No token provided | Add Authorization header |
| `invalid_credentials` | 401 | Wrong email/password | Verify credentials |
| `Please verify your email` | 401 | Email unverified | Complete email verification |
| `insufficient_permissions` | 403 | Role too low | Request appropriate access |

### Handling Expiration

Check token expiration before making requests:

```python
import jwt
import time

def is_token_valid(token):
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
        return payload['exp'] > time.time()
    except:
        return False

if not is_token_valid(token):
    token = login()  # Refresh token
```

---

## Session Management

### Logout

Explicitly invalidate a session:

```bash
curl -X POST "https://registry.fortran-lang.org/api/auth/logout" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Account Deletion

Delete your account and all associated data:

```bash
curl -X POST "https://registry.fortran-lang.org/api/users/delete" \
  -H "Authorization: Bearer SITE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "account-to-delete"
  }'
```

> Site-admin only. The caller supplies the target `username`; no password is
> requested. Deletes cascade to the user's namespaces, packages, and tarballs.

> **Warning:** This action is irreversible. All packages and namespaces you own will be orphaned or deleted.

---

## Next Steps

- [API Reference](api-reference.md) - Complete API documentation
- [Package Management](package-management.md) - Publishing packages
- [Namespace Management](namespace-management.md) - Managing namespaces
