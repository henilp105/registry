# Contributing Guide

Thank you for your interest in contributing to the FPM Registry! This guide will help you
get started with development, understand our standards, and submit quality contributions.

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. All contributors are
expected to:

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

- `good first issue` — suitable for newcomers
- `help wanted` — community help needed
- `documentation` — docs improvements
- `beginner-friendly` — low complexity

---

## Development Setup

### Prerequisites

- **Node.js ≥ 22** — the API runs on Cloudflare Workers and the frontend is React
- **npm** (bundled with Node)
- **Git**
- A **MongoDB** instance — a free [Atlas M0 cluster](https://www.mongodb.com/atlas) or a
  local `mongod` for offline work

No Docker, no Python, and no web server are required.

### API setup (`worker/`)

The API is a Cloudflare Worker written in TypeScript, with a Durable Object owning the
MongoDB connection and the password KDF.

```bash
cd worker

# Install dependencies
npm ci

# Configure local development. `.dev.vars` is gitignored — never commit it.
cp .dev.vars.example .dev.vars
#   MONGO_URI=...            your Atlas or local connection string
#   JWT_SECRET_KEY=...       node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
#   SALT=...                 only read by the legacy hash verifier

# Run the development server (wrangler dev)
npm run dev
# → http://localhost:8787
```

### Frontend setup (`frontend/`)

```bash
cd frontend

npm ci

# Point the app at the local Worker
REACT_APP_REGISTRY_API_URL=http://localhost:8787 npm start
# → http://localhost:3000
```

`REACT_APP_REGISTRY_API_URL` is inlined at **build** time, so changing it requires a
rebuild, not a restart.

---

## Project Structure

```
registry/
├── worker/                 # Cloudflare Worker API (TypeScript)
│   ├── src/
│   │   ├── index.ts        # Worker entry: CORS, rate limiting, health, crons
│   │   ├── router.ts       # Route table
│   │   ├── routes/         # One module per resource (auth, users, packages, …)
│   │   ├── lib/            # JWT, password hashing, cache, validators, storage
│   │   └── db/             # Durable Object pool, BSON/RPC conversion, indexes
│   ├── test/               # Vitest suites (hermetic + live-Atlas)
│   └── wrangler.jsonc      # Bindings and per-environment vars
├── frontend/               # React single-page app (CRA)
│   └── src/
│       ├── pages/          # Route-level components
│       ├── components/     # Reusable components
│       └── store/          # Redux state
├── scripts/                # Audit harnesses and CI gates
└── docs/                   # Documentation
```

---

## Coding Standards

### TypeScript (API)

- Strict TypeScript; `npm run typecheck` must pass for both `tsconfig.json` and
  `tsconfig.test.json`.
- Prefer small, dependency-free modules. The Worker's 10 ms CPU budget is a hard
  constraint — keep heavy work (KDF, Mongo connection, hashing) inside the Durable Object.
- Use the structured `logger` (`src/lib/logger.ts`) rather than bare `console.log`.
- Successful responses are HTTP 2xx with a body `code: 200`; failures are non-2xx with
  `{ code, message }`. This is enforced by the tests in `worker/test/`.

```ts
// Good: explicit types, documented intent, no hidden work in a handler
export function clampPage(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PAGE_SIZE) : 1;
}
```

### JavaScript / React (frontend)

- Functional components with hooks.
- Keep the theme writers (`frontend/src/theme/theme.js` and the inline script in
  `frontend/public/index.html`) in sync — CI checks that both set `data-bs-theme`.

### Formatting

```bash
# API
cd worker
npm run format       # prettier --write src test
npm run lint         # eslint src test

# Frontend
cd frontend
npx prettier --write src/
```

---

## Testing

### API tests

```bash
cd worker

npm test                      # all suites
npm test -- password          # only files matching "password"
npm run typecheck             # tsc, both projects
npm run lint                  # eslint
```

The suite is split into **hermetic** tests (pure modules: JWT, PBKDF2, validators, BSON
conversion, retry policy) and **live-Atlas** tests that need `MONGO_URI` in
`worker/.dev.vars`. Live tests skip when no cluster is configured.

When you fix a bug, add a regression test that **fails against the bug**. A test that
passes both before and after is not coverage.

### Validator tests

```bash
python -m pytest scripts/test_validate_packages.py -v
```

### Frontend

```bash
cd frontend
npm test
npm run build       # must succeed; CI runs it as an invariant check
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
2. Send request '...'
3. See error

**Expected behavior**
What you expected to happen.

**Environment**
- Endpoint / route: [e.g. POST /packages]
- Environment: [e.g. development / staging / production]

**Additional context**
Any other relevant information. **Redact secrets, tokens, and connection strings.**
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
Any other context.
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

````markdown
# Page Title

Brief introduction paragraph.

## Section Heading

Content with explanations.

### Subsection

More detailed content.

#### Code Example

```ts
// Example code
```

## Next Steps

- Related Doc (related-doc.md)
````

---

## Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **Major** (X.0.0): Breaking changes
- **Minor** (0.X.0): New features
- **Patch** (0.0.X): Bug fixes

### Release Checklist

1. [ ] All tests pass on `main`
2. [ ] Version bumped in `worker/package.json` and `worker/src/index.ts`
3. [ ] Documentation updated
4. [ ] Release notes drafted
5. [ ] Tag created and pushed
6. [ ] GitHub release published
7. [ ] Worker deployed (`npm run deploy:production`)

---

## Getting Help

### Resources

- **Documentation**: [Documentation index](./README.md)
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
