# FPM Registry

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020.svg)](https://workers.cloudflare.com/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://reactjs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-8.0-47A248.svg)](https://www.mongodb.com/)

The official package registry for the **Fortran Package Manager (fpm)**. A serverless,
full-stack application for publishing, discovering, and managing Fortran packages — no
servers to run, and **$0.00/month** on free tiers.

> **Note**: This registry is currently in testing phase. The database may be reset during
> development. Production use is not recommended yet.

---

## ✨ Features

- 📦 **Package Management** — Upload, version, and distribute Fortran packages
- 🔍 **Package Discovery** — Search and browse packages with filtering
- 👥 **Namespace Organization** — Group packages under organizational namespaces
- 🔐 **Access Control** — Role-based permissions (admins, maintainers, users)
- 🔑 **Secure Authentication** — JWT auth with revocable, scoped upload tokens for CI/CD
- 📊 **Package Ratings** — Community ratings and feedback
- 🚀 **CLI Integration** — Direct publishing via `fpm publish`
- 📖 **API Documentation** — Generated OpenAPI, served at `/apidocs`
- ⚡ **Edge-native** — Cloudflare Workers + Durable Objects, MongoDB Atlas, R2, KV

---

## 🏗️ Architecture

| Piece | Technology | Role |
|-------|-----------|------|
| API | Cloudflare Workers + Durable Objects | Routing, auth, business logic |
| Database | MongoDB Atlas (free M0) | Metadata only — never tarballs |
| Artifacts | Cloudflare R2 | Package tarballs, free egress |
| Cache | Cloudflare KV + Cache API | Hot metadata and search results |
| Frontend | React (CRA) on Cloudflare Pages | Web UI |
| Validation | GitHub Actions | Unpacks and verifies uploaded packages |

The MongoDB connection and the password KDF live in a **Durable Object**, not the Worker
handler, because the Workers free tier allows only 10 ms of CPU per request. See
[`DEPLOYMENT.md`](DEPLOYMENT.md) for the full rationale and runbook.

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Install fpm and publish your first package |
| [API Reference](docs/api-reference.md) | Complete REST API documentation |
| [Authentication](docs/authentication.md) | Auth flows, JWT, and RBAC |
| [Package Management](docs/package-management.md) | Publishing and managing packages |
| [Namespace Management](docs/namespace-management.md) | Organizing packages |
| [Deployment](DEPLOYMENT.md) | Serverless deployment runbook |
| [Contributing](docs/contributing.md) | Development setup and guidelines |
| [API Contract](docs/API_CONTRACT.md) | The frozen, machine-checked API surface |

The live API serves its own generated OpenAPI document at `/apidocs` and
`/apidocs/openapi.json`.

---

## 🚀 Quick Start

### Publishing a package with fpm

The fpm CLI (v0.8.2+) can publish directly to the registry:

```bash
fpm publish --token <upload-token> --registry <api-url>
```

See the [fpm documentation](https://fpm.fortran-lang.org/registry/index.html) for details.

### Local development

Prerequisites: **Node.js ≥ 22** and a free MongoDB Atlas cluster (or a local MongoDB).

```bash
# ── API ───────────────────────────────────────────────────────────────────────
cd worker
npm ci
cp .dev.vars.example .dev.vars    # fill in MONGO_URI, JWT_SECRET_KEY, SALT
npm run dev                       # wrangler dev → http://localhost:8787

# ── Frontend (in a second terminal) ───────────────────────────────────────────
cd frontend
npm ci
REACT_APP_REGISTRY_API_URL=http://localhost:8787 npm start
# → http://localhost:3000
```

---

## 🛠️ Development

### API (`worker/`)

```bash
cd worker
npm run typecheck   # tsc, both projects
npm run lint        # eslint
npm test            # vitest (hermetic + live-Atlas suites)
npm run format      # prettier
```

### Frontend (`frontend/`)

```bash
cd frontend
npm ci
npm start           # development server on :3000
npm run build       # production build into build/
npm test            # react-scripts test
```

---

## ⚙️ Configuration

The Worker reads configuration from `worker/wrangler.jsonc` (`vars`) and from secrets.

| Secret | Purpose | Required |
|--------|---------|----------|
| `MONGO_URI` | MongoDB Atlas connection string | yes |
| `SALT` | Salt for legacy `sha256(password + SALT)` verification | yes |
| `JWT_SECRET_KEY` | HS256 signing key for access/refresh tokens | yes |
| `VALIDATION_SECRET` | Shared secret for the GitHub Actions validation callback | yes |
| `BREVO_API_KEY` | Brevo HTTP API key for verification/reset email | optional |

Set secrets with `wrangler secret put <NAME>` — never commit them. Generate random
values with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> ⚠️ Changing `SALT` after accounts exist locks every existing user out. It is not a
> free rotation.

---

## 🤝 Contributing

We welcome contributions! See the [Contributing Guide](docs/contributing.md) for
development setup, coding standards, and the pull request process.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 🐛 Reporting Issues

1. Check [existing issues](https://github.com/fortran-lang/registry/issues)
2. Open a [new issue](https://github.com/fortran-lang/registry/issues/new)
3. Include steps to reproduce and environment details

---

## 📜 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file.

---

## 🙏 Acknowledgments

- [Fortran-lang community](https://fortran-lang.org/) — for building the modern Fortran ecosystem
- [fpm](https://github.com/fortran-lang/fpm) — the Fortran Package Manager
- All [contributors](https://github.com/fortran-lang/registry/graphs/contributors) who helped build this registry

<p align="center">
  Built with ❤️ by the <a href="https://fortran-lang.org/">Fortran community</a>
</p>
