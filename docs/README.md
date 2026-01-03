# FPM Registry Documentation

Welcome to the official documentation for the **Fortran Package Manager (FPM) Registry**. This registry serves as the central repository for Fortran packages, enabling developers to share, discover, and manage Fortran libraries and applications.

## Table of Contents

1. [Getting Started](getting-started.md) - Installation and quick start guide
2. [Architecture](architecture.md) - System design and components
3. [API Reference](api-reference.md) - Complete REST API documentation
4. [Authentication](authentication.md) - User authentication and authorization
5. [Package Management](package-management.md) - Publishing and managing packages
6. [Namespace Management](namespace-management.md) - Organizing packages with namespaces
7. [Deployment Guide](deployment.md) - Production deployment instructions
8. [Contributing](contributing.md) - Development setup and contribution guidelines

## Overview

The FPM Registry is a web-based service that provides:

- **Package Discovery** - Search and browse Fortran packages
- **Version Management** - Semantic versioning with dependency resolution
- **Namespace Organization** - Group packages under organizational namespaces
- **Access Control** - Fine-grained permissions for maintainers and admins
- **API Access** - RESTful API for CLI tools and integrations

## Quick Links

| Resource | Description |
|----------|-------------|
| [API Endpoint](/) | Base URL for API requests |
| [Health Check](/health) | Service health status |
| [Package Search](/packages) | Browse all packages |
| [Swagger Docs](/apidocs) | Interactive API documentation |

## System Requirements

### For Users
- Modern web browser (Chrome, Firefox, Safari, Edge)
- [fpm](https://github.com/fortran-lang/fpm) CLI tool for package management

### For Deployment
- Docker 20.10+ and Docker Compose 2.0+
- MongoDB 7.0+
- 2GB RAM minimum (4GB recommended)
- 10GB disk space for package storage

## Version

Current Version: **2.0.1**

## License

This project is licensed under the MIT License. See [LICENSE](../LICENSE) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/fortran-lang/fpm-registry/issues)
- **Discussions**: [GitHub Discussions](https://github.com/fortran-lang/fpm-registry/discussions)
- **Fortran Discourse**: [Fortran-lang Discourse](https://fortran-lang.discourse.group/)

---

*Built with ❤️ by the Fortran community*
