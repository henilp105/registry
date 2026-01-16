# Namespace Management

Namespaces organize packages under a common identity, providing ownership, access control, and discoverability. This guide covers namespace creation, administration, and best practices.

## Understanding Namespaces

### What is a Namespace?

A namespace is a container for related packages, similar to:
- GitHub organizations
- npm scopes (`@organization/package`)
- Python namespaces

Example namespace structure:
```
fortran-lang/                  # Namespace
├── stdlib                     # Package
├── fpm                        # Package
└── test-drive                 # Package
```

### Namespace Benefits

| Benefit | Description |
|---------|-------------|
| **Organization** | Group related packages logically |
| **Identity** | Establish recognizable brand/organization |
| **Access Control** | Manage who can publish packages |
| **Discovery** | Users find all your packages easily |
| **Trust** | Verified namespaces indicate authenticity |

---

## Creating Namespaces

### Prerequisites

- ✅ Verified user account
- ✅ Logged in (valid JWT token)

### Create via API

```bash
curl -X POST "https://registry.fortran-lang.org/api/namespaces" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "namespace_description": "A collection of scientific computing libraries"
  }'
```

**Response (201 Created):**
```json
{
  "code": 201,
  "message": "Namespace created successfully."
}
```

### Naming Rules

| Rule | Valid | Invalid |
|------|-------|---------|
| Lowercase letters | `mypackage` | `MyPackage` |
| Numbers | `lib2024` | - |
| Hyphens | `my-lib` | `my_lib` |
| Length (3-50 chars) | `fpm` | `ab` |
| Start with letter | `json-lib` | `123lib` |

### Reserved Namespaces

Some namespaces are reserved:
- `fortran-lang` - Official Fortran community packages
- `fpm` - fpm-related packages
- `admin` - System reserved
- Common library names

---

## Namespace Roles

### Role Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                         ADMIN                               │
│  • Full namespace control                                   │
│  • Add/remove admins and maintainers                        │
│  • Delete namespace                                         │
│  • Generate upload tokens                                   │
├─────────────────────────────────────────────────────────────┤
│                      MAINTAINER                             │
│  • Upload packages to namespace                             │
│  • Manage package maintainers                               │
│  • Update package metadata                                  │
│  • Delete package versions                                  │
├─────────────────────────────────────────────────────────────┤
│                         USER                                │
│  • Download packages                                        │
│  • Rate packages                                            │
│  • Report issues                                            │
└─────────────────────────────────────────────────────────────┘
```

### Permission Matrix

| Action | User | Maintainer | Admin |
|--------|:----:|:----------:|:-----:|
| Download packages | ✅ | ✅ | ✅ |
| View namespace info | ✅ | ✅ | ✅ |
| Upload packages | ❌ | ✅ | ✅ |
| Delete package versions | ❌ | ✅ | ✅ |
| Add package maintainers | ❌ | ✅ | ✅ |
| Generate upload tokens | ❌ | ❌ | ✅ |
| Add namespace maintainers | ❌ | ❌ | ✅ |
| Add namespace admins | ❌ | ❌ | ✅ |
| Delete namespace | ❌ | ❌ | ✅ |

---

## Managing Administrators

### Adding an Admin

Only existing admins can add new admins:

```bash
curl -X POST "https://registry.fortran-lang.org/api/your-username/admin" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "new_admin": "trusted-user"
  }'
```

**Response:**
```json
{
  "code": 200,
  "message": "Admin added successfully."
}
```

### Removing an Admin

```bash
curl -X POST "https://registry.fortran-lang.org/api/your-username/admin/remove" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "admin": "former-admin"
  }'
```

### Viewing Admins

```bash
curl "https://registry.fortran-lang.org/api/namespaces/my-namespace/admins" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "code": 200,
  "admins": ["owner-user", "trusted-user"]
}
```

---

## Managing Maintainers

### Adding a Maintainer

Admins can add maintainers to the namespace:

```bash
curl -X POST "https://registry.fortran-lang.org/api/your-username/namespace/maintainer" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "new_maintainer": "contributor-user"
  }'
```

### Removing a Maintainer

```bash
curl -X POST "https://registry.fortran-lang.org/api/your-username/namespace/maintainer/remove" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "maintainer": "contributor-user"
  }'
```

### Viewing Maintainers

```bash
curl "https://registry.fortran-lang.org/api/namespaces/my-namespace/maintainers" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "code": 200,
  "maintainers": ["contributor-user", "another-maintainer"]
}
```

---

## Upload Tokens

Upload tokens enable publishing packages without exposing account credentials.

### Generating Tokens

Only namespace admins can generate tokens:

```bash
curl -X POST "https://registry.fortran-lang.org/api/namespaces/my-namespace/uploadToken" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "code": 200,
  "upload_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### Token Properties

| Property | Description |
|----------|-------------|
| Scope | Limited to specific namespace |
| Permissions | Upload packages only |
| Expiration | Long-lived (configurable) |
| Revocable | Can be invalidated |

### Using Tokens

```bash
# With fpm
fpm publish --token YOUR_UPLOAD_TOKEN

# With curl
curl -X POST "https://registry.fortran-lang.org/api/packages" \
  -H "Authorization: Bearer YOUR_UPLOAD_TOKEN" \
  -F "tarball=@package.tar.gz"
```

### Package-Specific Tokens

Generate tokens for individual packages:

```bash
curl -X POST "https://registry.fortran-lang.org/api/packages/my-namespace/my-package/uploadToken" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Namespace Information

### Viewing Namespace Details

```bash
curl "https://registry.fortran-lang.org/api/namespaces/my-namespace"
```

**Response:**
```json
{
  "namespace": "my-namespace",
  "namespace_description": "A collection of scientific computing libraries",
  "created_at": "2024-01-15T10:30:00Z",
  "packages": ["stdlib", "json-fortran", "test-drive"],
  "package_count": 3
}
```

### Listing Namespace Packages

```bash
curl "https://registry.fortran-lang.org/api/namespaces/my-namespace/packages"
```

**Response:**
```json
{
  "code": 200,
  "packages": [
    {
      "name": "stdlib",
      "description": "Fortran Standard Library",
      "latest_version": "0.3.0",
      "downloads": 15420
    },
    {
      "name": "json-fortran",
      "description": "JSON parsing library",
      "latest_version": "8.3.0",
      "downloads": 8932
    }
  ]
}
```

---

## Deleting Namespaces

### Warning

> ⚠️ **Namespace deletion is permanent and irreversible.**
>
> - All packages will be deleted
> - All versions will be removed
> - All tokens will be invalidated
> - Other packages depending on yours may break

### Deletion Process

Only namespace admins can delete namespaces:

```bash
curl -X POST "https://registry.fortran-lang.org/api/namespaces/my-namespace/delete" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "password": "your-account-password"
  }'
```

### Pre-Deletion Checklist

1. ❓ Have you notified dependent projects?
2. ❓ Have you provided migration paths?
3. ❓ Have you deprecated packages first?
4. ❓ Have you backed up your source code?

---

## Organization Workflows

### Team Structure Example

```
acme-corp/                           # Organization namespace
├── Admins: [cto, lead-dev]
├── Maintainers: [dev1, dev2, dev3]
└── Packages:
    ├── acme-core      # Maintained by: [dev1]
    ├── acme-math      # Maintained by: [dev1, dev2]
    └── acme-io        # Maintained by: [dev2, dev3]
```

### Onboarding New Team Members

```bash
# 1. Add as namespace maintainer (admin action)
curl -X POST "https://registry.fortran-lang.org/api/cto/namespace/maintainer" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"namespace": "acme-corp", "new_maintainer": "new-hire"}'

# 2. Add to specific packages (maintainer action)
curl -X POST "https://registry.fortran-lang.org/api/lead-dev/maintainer" \
  -H "Authorization: Bearer MAINTAINER_TOKEN" \
  -d '{"namespace": "acme-corp", "package": "acme-core", "new_maintainer": "new-hire"}'
```

### Offboarding Team Members

```bash
# 1. Remove from all packages
curl -X POST "https://registry.fortran-lang.org/api/lead-dev/maintainer/remove" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"namespace": "acme-corp", "package": "acme-core", "maintainer": "former-employee"}'

# 2. Remove from namespace
curl -X POST "https://registry.fortran-lang.org/api/cto/namespace/maintainer/remove" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"namespace": "acme-corp", "maintainer": "former-employee"}'

# 3. Regenerate upload tokens (security measure)
curl -X POST "https://registry.fortran-lang.org/api/namespaces/acme-corp/uploadToken" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

---

## Best Practices

### Namespace Naming

- ✅ Use your organization's name: `fortran-lang`
- ✅ Use project themes: `scientific-libs`
- ✅ Keep names short but descriptive
- ❌ Avoid generic names: `libs`, `packages`
- ❌ Avoid version numbers: `libs-v2`

### Access Control

- ✅ Limit admin access to essential personnel
- ✅ Use package-level tokens for CI/CD
- ✅ Regularly audit maintainer lists
- ✅ Revoke access promptly when needed
- ✅ Use separate tokens for different CI systems

### Security

- ✅ Never share admin credentials
- ✅ Regenerate tokens periodically
- ✅ Monitor for unauthorized uploads
- ✅ Enable two-factor authentication (when available)
- ✅ Review package contents before approving

### Documentation

- ✅ Document your namespace purpose
- ✅ Provide contact information
- ✅ Link to organization website
- ✅ Maintain CONTRIBUTING guidelines

---

## Troubleshooting

### "Namespace already exists"

The namespace name is taken. Try:
- Adding organization prefix: `acme-json` instead of `json`
- Using more specific names: `fortran-json-parser`

### "Insufficient permissions"

You're not an admin of the namespace:
- Contact an existing admin
- Verify you're using the correct JWT token
- Check token hasn't expired

### "Invalid namespace name"

Check naming rules:
- Lowercase only
- Letters, numbers, hyphens
- 3-50 characters
- Starts with letter

### "Cannot delete namespace"

Ensure:
- You're a namespace admin
- Password is correct
- All packages can be deleted

---

## Next Steps

- [Package Management](package-management.md) - Publishing packages
- [Authentication](authentication.md) - Security and tokens
- [API Reference](api-reference.md) - Complete API documentation
