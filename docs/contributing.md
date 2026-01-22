# Contributing Guide

Thank you for your interest in contributing to the FPM Registry! This guide will help you get started with development, understand our standards, and submit quality contributions.

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. All contributors are expected to:

- Be respectful and considerate
- Welcome newcomers and help them get started
- Focus on constructive feedback
- Accept responsibility for mistakes

Report unacceptable behavior to: fpm@fortran-lang.org

---

## Ways to Contribute

### Types of Contributions

| Type | Description |
|------|-------------|
| 🐛 **Bug Reports** | Report issues you encounter |
| 💡 **Feature Requests** | Suggest new functionality |
| 📝 **Documentation** | Improve docs and examples |
| 🔧 **Code** | Fix bugs or add features |
| 🧪 **Testing** | Add or improve tests |
| 🎨 **UI/UX** | Improve the frontend |
| 🌍 **Translation** | Localize the interface |

### Good First Issues

Look for issues labeled:
- `good first issue` - Suitable for newcomers
- `help wanted` - Community help needed
- `documentation` - Docs improvements
- `beginner-friendly` - Low complexity

---

## Development Setup

### Prerequisites

- **Python 3.10+** - Backend development
- **Node.js 18+** - Frontend development
- **Docker & Docker Compose** - Container development
- **Git** - Version control
- **MongoDB** - Database (or use Docker)

### Backend Setup

```bash
# Clone repository
git clone https://github.com/fortran-lang/registry.git
cd registry/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt  # Development dependencies

# Set environment variables
cp .env.example .env
# Edit .env with your settings

# Start MongoDB (using Docker)
docker run -d -p 27017:27017 --name mongo mongo:6.0

# Run development server
python app.py
# or
flask run --debug
```

### Frontend Setup

```bash
cd registry/frontend

# Install dependencies
npm install

# Start development server
npm start
# Runs on http://localhost:3000
```

### Full Stack with Docker

```bash
cd registry/backend

# Start all services
docker compose -f compose.yaml up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

---

## Project Structure

```
registry/
├── backend/
│   ├── app.py              # Flask application entry
│   ├── auth.py             # Authentication logic
│   ├── packages.py         # Package endpoints
│   ├── namespaces.py       # Namespace endpoints
│   ├── user.py             # User endpoints
│   ├── mongo.py            # Database client
│   ├── mail.py             # Email functionality
│   ├── validate.py         # Input validation
│   ├── models/
│   │   ├── package.py      # Package data model
│   │   ├── namespace.py    # Namespace data model
│   │   └── user.py         # User data model
│   ├── tests/
│   │   ├── base_case.py    # Test base class
│   │   ├── test_login.py   # Auth tests
│   │   ├── test_packages.py
│   │   └── test_signup.py
│   └── docker/
│       └── backend.Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.js          # Main component
│   │   ├── index.js        # Entry point
│   │   ├── pages/          # Page components
│   │   ├── components/     # Reusable components
│   │   └── store/          # State management
│   └── public/
└── docs/                   # Documentation
```

---

## Coding Standards

### Python Style Guide

We follow [PEP 8](https://peps.python.org/pep-0008/) with some additions:

```python
# Good: Clear, descriptive names
def get_package_by_namespace(namespace: str, package_name: str) -> dict:
    """Retrieve a package from the specified namespace.
    
    Args:
        namespace: The namespace containing the package.
        package_name: The name of the package to retrieve.
        
    Returns:
        Dictionary containing package information.
        
    Raises:
        PackageNotFoundError: If the package doesn't exist.
    """
    pass

# Bad: Unclear, no documentation
def get_pkg(ns, n):
    pass
```

### Python Formatting

```bash
# Format code
black .

# Sort imports
isort .

# Lint code
flake8 .
pylint backend/

# Type checking
mypy backend/
```

### JavaScript/React Style Guide

We use ESLint with Airbnb configuration:

```javascript
// Good: Functional components with hooks
const PackageCard = ({ package, onSelect }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <Card 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <CardTitle>{package.name}</CardTitle>
      <CardDescription>{package.description}</CardDescription>
    </Card>
  );
};

// Bad: Class component for simple UI
class PackageCard extends React.Component {
  // ...
}
```

### JavaScript Formatting

```bash
# Format code
npx prettier --write src/

# Lint code
npm run lint

# Fix lint issues
npm run lint:fix
```

---

## Testing

### Running Backend Tests

```bash
cd backend

# Run all tests
pytest

# Run with coverage
pytest --cov=. --cov-report=html

# Run specific test file
pytest tests/test_packages.py

# Run specific test
pytest tests/test_packages.py::test_upload_package

# Verbose output
pytest -v

# Stop on first failure
pytest -x
```

### Writing Tests

```python
# tests/test_packages.py
import pytest
from tests.base_case import BaseCase

class TestPackageUpload(BaseCase):
    """Tests for package upload functionality."""
    
    def test_upload_valid_package(self):
        """Valid package should upload successfully."""
        # Arrange
        token = self.get_upload_token()
        tarball = self.create_test_tarball()
        
        # Act
        response = self.client.post(
            '/packages',
            headers={'Authorization': f'Bearer {token}'},
            data={'tarball': tarball}
        )
        
        # Assert
        assert response.status_code == 200
        assert response.json['message'] == 'Package uploaded successfully'
    
    def test_upload_without_token_fails(self):
        """Upload without auth token should return 401."""
        tarball = self.create_test_tarball()
        
        response = self.client.post(
            '/packages',
            data={'tarball': tarball}
        )
        
        assert response.status_code == 401
    
    def test_upload_invalid_manifest_fails(self):
        """Package with invalid fpm.toml should fail validation."""
        token = self.get_upload_token()
        tarball = self.create_invalid_tarball()
        
        response = self.client.post(
            '/packages',
            headers={'Authorization': f'Bearer {token}'},
            data={'tarball': tarball}
        )
        
        assert response.status_code == 400
        assert 'invalid' in response.json['message'].lower()
```

### Running Frontend Tests

```bash
cd frontend

# Run tests
npm test

# Run with coverage
npm test -- --coverage

# Update snapshots
npm test -- -u
```

---

## Git Workflow

### Branch Naming

```
feature/add-package-search
bugfix/fix-upload-timeout
docs/update-api-reference
refactor/simplify-auth-logic
test/add-namespace-tests
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Formatting (no code change) |
| `refactor` | Code restructuring |
| `test` | Adding tests |
| `chore` | Maintenance tasks |
| `perf` | Performance improvement |

**Examples:**
```
feat(packages): add package search by keywords

fix(auth): resolve JWT token expiration issue

docs(api): update authentication examples

refactor(models): simplify package validation logic

test(namespaces): add tests for admin management
```

### Commit Best Practices

- ✅ Make atomic commits (one logical change)
- ✅ Write clear, descriptive messages
- ✅ Reference issues when applicable (`Fixes #123`)
- ❌ Don't commit generated files
- ❌ Don't commit secrets or credentials
- ❌ Don't combine unrelated changes

---

## Pull Request Process

### Before Submitting

1. **Fork the repository** on GitHub
2. **Create a feature branch** from `main`
3. **Make your changes** following coding standards
4. **Add/update tests** for your changes
5. **Run tests locally** and ensure they pass
6. **Update documentation** if needed
7. **Commit with clear messages**

### Submitting a PR

1. Push your branch to your fork
2. Open a Pull Request to `main`
3. Fill out the PR template completely
4. Link related issues
5. Request reviewers

### PR Template

```markdown
## Description
Brief description of changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Fixes #123

## Testing
- [ ] Tests pass locally
- [ ] New tests added
- [ ] Existing tests updated

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### Review Process

1. **Automated checks** run (CI/CD)
2. **Maintainer review** within 48 hours
3. **Address feedback** with new commits
4. **Approval** from at least one maintainer
5. **Merge** by maintainer

---

## Issue Reporting

### Bug Reports

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment**
- OS: [e.g., Ubuntu 22.04]
- Browser: [e.g., Firefox 120]
- Version: [e.g., 2.0.0]

**Additional context**
Any other relevant information.
```

### Feature Requests

```markdown
**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
What you want to happen.

**Describe alternatives considered**
Other solutions you've considered.

**Additional context**
Any other context or screenshots.
```

---

## Documentation

### Writing Documentation

- Use clear, simple language
- Include code examples
- Keep paragraphs short
- Use proper Markdown formatting
- Add cross-references to related docs

### Documentation Structure

```markdown
# Page Title

Brief introduction paragraph.

## Section Heading

Content with explanations.

### Subsection

More detailed content.

#### Code Example

```python
# Example code
```

## Next Steps

- [Related Doc](related-doc.md)
```

### Building Documentation

```bash
# Install mkdocs
pip install mkdocs mkdocs-material

# Serve locally
mkdocs serve
# View at http://localhost:8000

# Build static site
mkdocs build
```

---

## Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):
- **Major** (X.0.0): Breaking changes
- **Minor** (0.X.0): New features
- **Patch** (0.0.X): Bug fixes

### Release Checklist

1. [ ] All tests pass on `main`
2. [ ] CHANGELOG.md updated
3. [ ] Version bumped in code
4. [ ] Documentation updated
5. [ ] Release notes drafted
6. [ ] Tag created and pushed
7. [ ] GitHub release published
8. [ ] Docker images published

---

## Getting Help

### Resources

- **Documentation**: [docs/](./README.md)
- **Issue Tracker**: [GitHub Issues](https://github.com/fortran-lang/registry/issues)
- **Discussions**: [GitHub Discussions](https://github.com/fortran-lang/registry/discussions)

### Community

- **Fortran Discourse**: [fortran-lang.discourse.group](https://fortran-lang.discourse.group)
- **Fortran Slack**: [fortran-lang.slack.com](https://fortran-lang.slack.com)

### Maintainers

For urgent issues or security concerns:
- Email: fpm@fortran-lang.org

---

## Recognition

Contributors are recognized in:
- CONTRIBUTORS.md file
- Release notes
- GitHub contributor graph

Thank you for contributing to the FPM Registry! 🙏
