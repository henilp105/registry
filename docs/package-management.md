# Package Management

This guide covers everything you need to know about creating, publishing, and managing packages in the FPM Registry.

## Package Structure

A valid FPM package requires a proper directory structure and `fpm.toml` manifest file.

### Required Structure

```
my-package/
├── fpm.toml          # Package manifest (required)
├── README.md         # Package documentation (recommended)
├── LICENSE           # License file (recommended)
├── src/              # Library source files
│   └── my_module.f90
├── app/              # Application source files
│   └── main.f90
├── test/             # Test source files
│   └── test_main.f90
└── example/          # Example programs
    └── demo.f90
```

### fpm.toml Manifest

The `fpm.toml` file defines your package metadata:

```toml
name = "my-package"
version = "1.0.0"
license = "MIT"
author = "Your Name <your.email@example.com>"
maintainer = "your.email@example.com"
copyright = "Copyright 2026, Your Name"
description = "A brief description of your package"
homepage = "https://github.com/you/my-package"
repository = "https://github.com/you/my-package"
keywords = ["science", "math", "fortran"]
categories = ["science"]

[build]
auto-executables = true
auto-tests = true
auto-examples = true

[library]
source-dir = "src"

[dependencies]
stdlib = { namespace = "fortran-lang" }

[dev-dependencies]
test-drive = { namespace = "fortran-lang" }
```

### Required Fields

| Field | Description |
|-------|-------------|
| `name` | Package name (lowercase, alphanumeric, hyphens) |
| `version` | Semantic version (MAJOR.MINOR.PATCH) |
| `license` | SPDX license identifier |

### Recommended Fields

| Field | Description |
|-------|-------------|
| `author` | Package author(s) |
| `description` | Brief package description |
| `repository` | Source repository URL |
| `keywords` | Searchable keywords |

---

## Semantic Versioning

The registry follows [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH

Example: 2.1.0
         │ │ └── Patch: Bug fixes (backward compatible)
         │ └──── Minor: New features (backward compatible)
         └────── Major: Breaking changes
```

### Version Guidelines

| Change Type | Version Bump | Example |
|------------|--------------|---------|
| Bug fix | Patch | 1.0.0 → 1.0.1 |
| New feature | Minor | 1.0.0 → 1.1.0 |
| Breaking change | Major | 1.0.0 → 2.0.0 |
| Initial development | 0.x.x | 0.1.0 |
| First stable release | 1.0.0 | 1.0.0 |

### Pre-release Versions

```toml
version = "2.0.0-alpha.1"
version = "2.0.0-beta.2"
version = "2.0.0-rc.1"
```

---

## Publishing Packages

### Prerequisites

1. ✅ Registered account (email verified)
2. ✅ Namespace created or maintainer access
3. ✅ Valid `fpm.toml` manifest
4. ✅ Upload token generated

### Step 1: Create a Namespace

```bash
curl -X POST "https://registry.fortran-lang.org/api/namespaces" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "namespace_description": "My Fortran packages"
  }'
```

### Step 2: Generate Upload Token

```bash
curl -X POST "https://registry.fortran-lang.org/api/namespaces/my-namespace/uploadToken" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Save the returned `upload_token`.

### Step 3: Publish with fpm

The easiest way to publish:

```bash
cd my-package/
fpm publish --token YOUR_UPLOAD_TOKEN
```

### Step 3 (Alternative): Manual Upload

```bash
# Create tarball
tar -czvf my-package-1.0.0.tar.gz \
  --exclude='.git' \
  --exclude='build' \
  --exclude='*.o' \
  .

# Upload
curl -X POST "https://registry.fortran-lang.org/api/packages" \
  -H "Authorization: Bearer YOUR_UPLOAD_TOKEN" \
  -F "tarball=@my-package-1.0.0.tar.gz" \
  -F "namespace=my-namespace"
```

### Package Verification

After upload, packages undergo automatic verification:

1. **Tarball extraction** - Validate archive structure
2. **Manifest validation** - Check `fpm.toml` syntax and fields
3. **Dependency resolution** - Verify all dependencies exist
4. **Build test** - Attempt to build the package
5. **Digest verification** - Validate source file integrity

Check verification status:

```bash
curl "https://registry.fortran-lang.org/api/packages/my-namespace/my-package"
```

```json
{
  "versions": [
    {
      "version": "1.0.0",
      "is_verified": true,
      "unable_to_verify": false
    }
  ]
}
```

---

## Updating Packages

### Publishing New Versions

Simply publish with an incremented version:

```toml
# fpm.toml
version = "1.1.0"  # Was 1.0.0
```

```bash
fpm publish --token YOUR_UPLOAD_TOKEN
```

### Updating Metadata

Metadata is extracted from `fpm.toml` during upload. To update:

1. Modify `fpm.toml` (description, keywords, etc.)
2. Increment version number
3. Publish new version

> **Note:** You cannot modify metadata of existing versions. Publish a new version instead.

---

## Dependencies

### Declaring Dependencies

```toml
[dependencies]
# From registry with namespace
json-fortran = { namespace = "fortran-lang" }
stdlib = { namespace = "fortran-lang", version = "0.2.0" }

# From git repository
my-lib = { git = "https://github.com/user/my-lib" }
my-lib = { git = "https://github.com/user/my-lib", tag = "v1.0.0" }
my-lib = { git = "https://github.com/user/my-lib", branch = "develop" }

# Local path (development only)
local-lib = { path = "../local-lib" }
```

### Version Constraints

```toml
[dependencies]
# Exact version
lib = { namespace = "ns", version = "1.2.3" }

# Any version (latest)
lib = { namespace = "ns" }
```

### Development Dependencies

Dependencies only needed for testing:

```toml
[dev-dependencies]
test-drive = { namespace = "fortran-lang" }
```

---

## Searching Packages

### Web Interface

Browse packages at [https://registry.fortran-lang.org](https://registry.fortran-lang.org)

### API Search

```bash
# Basic search
curl "https://registry.fortran-lang.org/api/packages?query=json"

# With filters
curl "https://registry.fortran-lang.org/api/packages?query=math&license=MIT&sorted_by=downloads&sort=desc"

# Pagination
curl "https://registry.fortran-lang.org/api/packages?page=2&limit=20"
```

### Search Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `query` | Search term | `math`, `json` |
| `namespace` | Filter by namespace | `fortran-lang` |
| `license` | Filter by license | `MIT`, `BSD-3-Clause` |
| `sorted_by` | Sort field | `name`, `date`, `downloads` |
| `sort` | Sort order | `asc`, `desc` |
| `page` | Page number | `1`, `2`, `3` |
| `limit` | Results per page | `10`, `20`, `50` |

---

## Package Maintainers

### Adding Maintainers

Package owners can add other users as maintainers:

```bash
curl -X POST "https://registry.fortran-lang.org/api/your-username/maintainer" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "package": "my-package",
    "new_maintainer": "contributor-username"
  }'
```

### Removing Maintainers

```bash
curl -X POST "https://registry.fortran-lang.org/api/your-username/maintainer/remove" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "my-namespace",
    "package": "my-package",
    "maintainer": "contributor-username"
  }'
```

### Viewing Maintainers

```bash
curl "https://registry.fortran-lang.org/api/packages/my-namespace/my-package/maintainers"
```

---

## Deprecation and Deletion

### Deprecating a Package

Mark a package as deprecated (still visible but discouraged):

```bash
curl -X POST "https://registry.fortran-lang.org/api/packages/my-namespace/my-package/deprecate" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deprecated": true,
    "message": "This package is no longer maintained. Use new-package instead."
  }'
```

### Deleting a Version

Remove a specific version:

```bash
curl -X POST "https://registry.fortran-lang.org/api/packages/my-namespace/my-package/1.0.0/delete" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "password": "your-password"
  }'
```

### Deleting a Package

Remove an entire package (requires admin):

```bash
curl -X POST "https://registry.fortran-lang.org/api/packages/my-namespace/my-package/delete" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "password": "sudo-password"
  }'
```

> **Warning:** Deletion is permanent. Other packages depending on yours may break.

---

## Ratings and Feedback

### Rating a Package

Authenticated users can rate packages (1-5 stars):

```bash
curl -X POST "https://registry.fortran-lang.org/api/ratings/my-namespace/my-package" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 5
  }'
```

### Reporting Issues

Report problematic packages:

```bash
curl -X POST "https://registry.fortran-lang.org/api/report/my-namespace/my-package" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Package contains malicious code that attempts to..."
  }'
```

---

## Best Practices

### Package Quality

- ✅ Include comprehensive documentation
- ✅ Write unit tests for your code
- ✅ Use meaningful commit messages
- ✅ Follow Fortran best practices
- ✅ Include example programs
- ✅ Specify explicit public interfaces

### Versioning

- ✅ Follow semantic versioning strictly
- ✅ Document breaking changes in CHANGELOG
- ✅ Use pre-release versions for testing
- ✅ Don't delete published versions

### Metadata

- ✅ Write clear, concise descriptions
- ✅ Use relevant keywords for discoverability
- ✅ Include repository and homepage links
- ✅ Specify accurate license information

### Security

- ✅ Never include secrets in packages
- ✅ Review dependencies before including
- ✅ Keep upload tokens secure
- ✅ Report vulnerabilities responsibly

---

## Next Steps

- [Namespace Management](namespace-management.md) - Organizing packages
- [Authentication](authentication.md) - Security and access control
- [API Reference](api-reference.md) - Complete API documentation
