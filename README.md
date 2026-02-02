# FPM Registry

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-green.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://reactjs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.0+-47A248.svg)](https://www.mongodb.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)

The official package registry for the **Fortran Package Manager (fpm)**. A modern, full-stack web application for publishing, discovering, and managing Fortran packages.

> **Note**: This registry is currently in testing phase. The database may be reset during development. Production use is not recommended yet.

---

## ✨ Features

- 📦 **Package Management** - Upload, version, and distribute Fortran packages
- 🔍 **Package Discovery** - Search and browse packages with filtering
- 👥 **Namespace Organization** - Group packages under organizational namespaces
- 🔐 **Access Control** - Role-based permissions (admins, maintainers, users)
- 🔑 **Secure Authentication** - JWT-based auth with upload tokens for CI/CD
- 📊 **Package Ratings** - Community ratings and feedback
- 🚀 **CLI Integration** - Direct publishing via `fpm publish`
- 📖 **API Documentation** - Interactive Swagger/OpenAPI docs
- 🐳 **Docker Ready** - One-command deployment with Docker Compose

---

## 🌐 Live Instances

| Service | URL |
|---------|-----|
| **Backend API** | https://fpm-registry.vercel.app/ |
| **Frontend** | https://registry-phi.vercel.app/ |
| **API Docs** | https://fpm-registry.vercel.app/apidocs/ |

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation and first steps |
| [API Reference](docs/api-reference.md) | Complete REST API documentation |
| [Authentication](docs/authentication.md) | Auth flows, JWT, and RBAC |
| [Package Management](docs/package-management.md) | Publishing and managing packages |
| [Namespace Management](docs/namespace-management.md) | Organizing packages |
| [Deployment Guide](docs/deployment.md) | Production deployment |
| [Contributing](docs/contributing.md) | Development setup and guidelines |

---

## 🚀 Quick Start

### Publishing Packages with fpm

The fpm CLI (v0.8.2+) supports direct publishing to the registry:

```bash
# Publish your package
fpm publish --token <upload-token>
```

See [fpm documentation](https://fpm.fortran-lang.org/registry/index.html) for details.

### Running with Docker

The easiest way to run the full stack locally:

```bash
# Clone the repository
git clone https://github.com/fortran-lang/registry.git
cd registry

# Start all services (frontend + backend + MongoDB)
docker compose up -d
```

**Access Points:**
- 🌐 **Frontend**: http://localhost
- 🔌 **API**: http://localhost/api/
- 📖 **API Docs**: http://localhost/api/apidocs/

```bash
# View logs
docker compose logs -f

# Stop services
docker compose down
```

---

## 📁 Project Structure

```
registry/
├── backend/                 # Flask API server
│   ├── app.py              # Application entry point
│   ├── auth.py             # Authentication logic
│   ├── packages.py         # Package endpoints
│   ├── namespaces.py       # Namespace endpoints
│   ├── user.py             # User management
│   ├── mongo.py            # Database client
│   ├── models/             # Data models
│   ├── tests/              # Test suite
│   ├── docker/             # Dockerfiles
│   └── documentation/      # API specs (YAML)
├── frontend/               # React web application
│   ├── src/
│   │   ├── pages/          # Page components
│   │   ├── components/     # Reusable components
│   │   └── store/          # State management
│   ├── public/             # Static assets
│   └── build/              # Production build
├── docs/                   # Documentation
├── docker-compose.yaml     # Container orchestration
└── README.md
```

---

## 🛠️ Development Setup

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Python | 3.10+ | Backend API |
| Node.js | 18+ | Frontend build |
| MongoDB | 6.0+ | Database |
| Docker | 20.10+ | Containerization |

### Backend Development

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI and secrets

# Run development server
python server.py
# API available at http://localhost:9090
```

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Start development server
REACT_APP_REGISTRY_API_URL="http://localhost:9090" npm start
# Frontend available at http://localhost:3000
```

### Running Tests

```bash
cd backend

# Run tests with Docker
docker compose -f compose.test.yaml up --build

# Or run directly with pytest
pytest tests/ -v
```

---

## ⚙️ Configuration

### Environment Variables

Copy the example environment file and customize:

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Description | Default |
|----------|-------------|---------|
| `FRONTEND_PORT` | Port to expose frontend | `80` |
| `MONGO_DB_NAME` | MongoDB database name | `fpmregistry` |
| `SALT` | Password hashing salt | ⚠️ Change this! |
| `JWT_SECRET_KEY` | JWT signing secret | ⚠️ Change this! |
| `SUDO_PASSWORD` | Admin password | `admin` |
| `RESET_EMAIL` | SMTP email for password reset | (optional) |
| `RESET_PASSWORD` | SMTP password | (optional) |

### Production Deployment

For production, make sure to:

1. Change `SALT`, `JWT_SECRET_KEY`, and `SUDO_PASSWORD` to secure random values
2. Configure `RESET_EMAIL` and `RESET_PASSWORD` for password reset functionality
3. Consider using an external MongoDB instance for better data management

```bash
# Generate secure random values
openssl rand -hex 32  # Use for SALT and JWT_SECRET_KEY
```

---

##  MongoDB Tools Setup

For the registry archives functionality (weekly database dumps), install MongoDB tools:

<details>
<summary><strong>Ubuntu/Debian Installation</strong></summary>

```bash
# Import MongoDB public key
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -

# Add repository
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list

# Install tools
sudo apt-get update
sudo apt install mongodb-org-tools
```

</details>

See [MongoDB Tools Installation](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/) for other platforms.

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](docs/contributing.md) for:

- Development environment setup
- Coding standards and style guide
- Testing requirements
- Pull request process

### Quick Contribution Steps

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 🐛 Reporting Issues

Found a bug or have a feature request?

1. Check [existing issues](https://github.com/fortran-lang/registry/issues)
2. Open a [new issue](https://github.com/fortran-lang/registry/issues/new)
3. Include steps to reproduce and environment details

---

## 📜 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Fortran-lang community](https://fortran-lang.org/) - For building the modern Fortran ecosystem
- [fpm](https://github.com/fortran-lang/fpm) - The Fortran Package Manager
- All [contributors](https://github.com/fortran-lang/registry/graphs/contributors) who helped build this registry

---

## 📞 Support

| Channel | Link |
|---------|------|
| 💬 **Discourse** | [fortran-lang.discourse.group](https://fortran-lang.discourse.group/) |
| 💻 **GitHub Issues** | [fortran-lang/registry/issues](https://github.com/fortran-lang/registry/issues) |
| 📧 **Email** | fpm@fortran-lang.org |

---

<p align="center">
  Built with ❤️ by the <a href="https://fortran-lang.org/">Fortran community</a>
</p>