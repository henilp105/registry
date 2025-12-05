# Registry for Fortran Package Manager

We are currently in the testing phase of this registry.

1. Backend APIs are hosted at: https://fpm-registry.vercel.app/
2. Frontend is hosted at: https://registry-phi.vercel.app/
3. Documentation for the APIs are available at: https://fpm-registry.vercel.app/apidocs/

**Please note: the current registry is a playground: its database will be fully deleted once its functionality is established. Please do not use it for production yet! More information will follow.**

The fpm release [0.8.2](https://fortran-lang.discourse.group/t/fpm-version-0-8-2-released-centralized-registry-playground/5792) introduces fpm support for uploading packages to the fpm-registry server directly from the command-line interface:

```bash
fpm publish --token <upload-token-here>
```

fpm will now also interact with a web interface that helps manage namespaces & packages. Detailed information regarding the fpm CLI can be found here: [docs](https://fpm.fortran-lang.org/registry/index.html)

---

## 🚀 Quick Start with Docker

The easiest way to run the full stack (frontend + backend + database) is with Docker Compose.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

### One-Command Deployment

```bash
# Clone the repository
git clone https://github.com/fortran-lang/registry.git
cd registry

# Start everything
docker compose up -d
```

That's it! 🎉

- **Frontend**: http://localhost
- **API**: http://localhost/api/

### Stop the Application

```bash
docker compose down
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
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

## 🛠️ Development Setup

### Backend Only (with existing MongoDB)

```bash
cd backend
cp .env.example .env  # Configure your MongoDB URI
pip install -r requirements.txt
python server.py
```

### Frontend Only

```bash
cd frontend
npm install
REACT_APP_REGISTRY_API_URL="http://localhost:9090" npm start
```

### Running Tests

```bash
cd backend
docker compose -f compose.test.yaml up --build
```

## Steps to setup mongodump for registry Archives functionality
fpm - registry archives automatically created at weekly intervals by the mongodump command and stored in a tar archives format in the static directory of flask , to support caching and direct rendering of archives without manually fetching the mongodb for each archive request. to reduce the resource used by mongodb , we will only be installing the `mongodb-org-tools` only. the steps to setup mongodump on a Ubuntu linux 22.04 are:

1. Import the public key used by the package management system.

```
 wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
 ```

 2. Create a list file for MongoDB.

 ```
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
 ```

 3. Reload local package database and install the tools:

 ```
  sudo apt-get update
  sudo apt install mongodb-org-tools
 ```

for more details, please refer: [mongodb tools installation docs](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/).