# FPM Registry Documentation

Welcome to the official documentation for the **Fortran Package Manager (FPM) Registry**.
This registry is the central repository for Fortran packages, enabling developers to share,
discover, and manage Fortran libraries and applications.

## Table of Contents

1. [Getting Started](getting-started.md) — Install fpm and publish your first package
2. [API Reference](api-reference.md) — Complete REST API documentation
3. [Authentication](authentication.md) — User authentication and authorization
4. [Package Management](package-management.md) — Publishing and managing packages
5. [Namespace Management](namespace-management.md) — Organizing packages with namespaces
6. [Contributing](contributing.md) — Development setup and contribution guidelines

### Reference and design documents

| Document | What it is |
|----------|------------|
| [API Contract](API_CONTRACT.md) | The frozen, machine-checked API surface |
| [Serverless Migration Plan](SERVERLESS_MIGRATION_PLAN.md) | Why the edge architecture looks the way it does |
| [Baseline Audit](BASELINE_AUDIT.md) | The defect register that drove the rewrite |
| [Deployment](../DEPLOYMENT.md) | The serverless deployment runbook |

## Overview

The FPM Registry is a serverless web service that provides:

- **Package Discovery** — Search and browse Fortran packages
- **Version Management** — Semantic versioning with dependency resolution
- **Namespace Organization** — Group packages under organizational namespaces
- **Access Control** — Fine-grained permissions for maintainers and admins
- **API Access** — RESTful API for CLI tools and integrations

The API runs on Cloudflare Workers with MongoDB Atlas, R2, and KV. The frontend is a React
single-page app served from Cloudflare Pages. The whole stack fits within free tiers; see
[`DEPLOYMENT.md`](../DEPLOYMENT.md) for the budget and limits.

## Quick Links

| Resource | Description |
|----------|-------------|
| [API Reference](api-reference.md) | Base URL and request formats |
| [Health Check](/health) | Service health status |
| [Package Search](/packages) | Browse all packages |
| [Swagger Docs](/apidocs) | Interactive API documentation |

## System Requirements

### For Users

- A modern web browser (Chrome, Firefox, Safari, Edge)
- [fpm](https://github.com/fortran-lang/fpm) CLI for package management

### For Contributors

- Node.js ≥ 22 (API and frontend)
- A MongoDB Atlas free cluster, or a local MongoDB for offline development

### For Deployment

- A free Cloudflare account (Workers, R2, KV, Pages)
- A MongoDB Atlas M0 free cluster
- No servers, containers, or web servers required

## Version

Current API version: **3.0.0** (serverless). The last self-hosted release was **2.0.1**.

## License

This project is licensed under the MIT License. See [LICENSE](../LICENSE) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/fortran-lang/registry/issues)
- **Discussions**: [GitHub Discussions](https://github.com/fortran-lang/registry/discussions)
- **Fortran Discourse**: [Fortran-lang Discourse](https://fortran-lang.discourse.group/)

---

*Built with ❤️ by the Fortran community*
