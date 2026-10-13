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
curl -X POST "https://registry.fortran-lang.org/namespaces" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d "namespace=my-namespace&namespace_description=A collection of scientific computing libraries"
```

**Response:**
```json
{
  "code": 200,
  "message": "Namespace created successfully."
}
```

### Naming Rules

A namespace name matches `^[a-zA-Z0-9_-]{1,64}$`:

| Rule | Valid | Invalid |
|------|-------|---------|
| Letters (any case) | `mypackage`, `MyPackage` | `my package` |
| Numbers | `lib2024` | - |
| Hyphens and underscores | `my-lib`, `my_lib` | `my.lib` |
| Length (1-64 chars) | `fpm` | a 65-character name |

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
| Download packages | Yes | Yes | Yes |
| View namespace info | Yes | Yes | Yes |
| Upload packages | No | Yes | Yes |
| Delete package versions | No | Yes | Yes |
| Add package maintainers | No | Yes | Yes |
| Generate upload tokens | No | No | Yes |
| Add namespace maintainers | No | No | Yes |
| Add namespace admins | No | No | Yes |
| Delete namespace | No | No | Yes |

---

## Managing Administrators

### Adding an Admin

Only existing admins can add new admins:

```bash
curl -X POST "https://registry.fortran-lang.org/your-username/namespace/admin" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d "username=trusted-user&namespace=my-namespace"
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
curl -X POST "https://registry.fortran-lang.org/your-username/namespace/admin/remove" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d "username=former-admin&namespace=my-namespace"
```

### Viewing Admins

Listing members is a `POST` (the original API's choice, preserved). The
response key is `users`:

```bash
curl -X POST "https://registry.fortran-lang.org/namespaces/my-namespace/admins" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "code": 200,
  "users": ["owner-user", "trusted-user"]
}
```

---

## Managing Maintainers

### Adding a Maintainer

Admins can add maintainers to the namespace:

```bash
curl -X POST "https://registry.fortran-lang.org/your-username/namespace/maintainer" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d "username=contributor-user&namespace=my-namespace"
```

### Removing a Maintainer

```bash
curl -X POST "https://registry.fortran-lang.org/your-username/namespace/maintainer/remove" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d "username=contributor-user&namespace=my-namespace"
```

### Viewing Maintainers

```bash
curl "https://registry.fortran-lang.org/namespaces/my-namespace/maintainers" \
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
curl -X POST "https://registry.fortran-lang.org/namespaces/my-namespace/uploadToken" \
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
curl -X POST "https://registry.fortran-lang.org/packages" \
  -H "Authorization: Bearer YOUR_UPLOAD_TOKEN" \
  -F "tarball=@package.tar.gz"
```

### Package-Specific Tokens

Generate tokens for individual packages:

```bash
curl -X POST "https://registry.fortran-lang.org/packages/my-namespace/my-package/uploadToken" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Namespace Information

### Viewing Namespace Details

```bash
curl "https://registry.fortran-lang.org/namespace/my-namespace"
```

Note the **singular** `namespace` segment; the plural `namespaces` is used only
for writes. The response carries the description, creation date, and the
namespace's packages:

```json
{
  "code": 200,
  "description": "A collection of scientific computing libraries",
  "createdAt": "2024-01-15T10:30:00Z",
  "packages": [
    "stdlib",
    "json-fortran",
    "test-drive"
  ]
}
```

### Listing Namespace Packages

There is no separate packages route; the package list is the `packages` field
of the response above. To read a single package, use
`GET /packages/{namespace}/{package}`.

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

Only site admins can delete namespaces. The route is `POST` to the singular
`/namespace/{name}/delete` and needs only the bearer token:

```bash
curl -X POST "https://registry.fortran-lang.org/namespace/my-namespace/delete" \
  -H "Authorization: Bearer YOUR_TOKEN"
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
curl -X POST "https://registry.fortran-lang.org/cto/namespace/maintainer" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d "username=new-hire&namespace=acme-corp"

# 2. Add to specific packages (maintainer action)
curl -X POST "https://registry.fortran-lang.org/lead-dev/maintainer" \
  -H "Authorization: Bearer MAINTAINER_TOKEN" \
  -d "username=new-hire&namespace=acme-corp&package=acme-core"
```

### Offboarding Team Members

```bash
# 1. Remove from all packages
curl -X POST "https://registry.fortran-lang.org/lead-dev/maintainer/remove" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d "username=former-employee&namespace=acme-corp&package=acme-core"

# 2. Remove from namespace
curl -X POST "https://registry.fortran-lang.org/cto/namespace/maintainer/remove" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d "username=former-employee&namespace=acme-corp"

# 3. Regenerate upload tokens (security measure)
curl -X POST "https://registry.fortran-lang.org/namespaces/acme-corp/uploadToken" \
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
- Letters (any case), numbers, hyphens and underscores only
- 1-64 characters

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
