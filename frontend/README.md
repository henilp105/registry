# fpm Registry — Frontend

The React single-page app for the Fortran Package Manager registry. It is a
static build served from Cloudflare Pages; all data comes from the serverless
API in [`../worker`](../worker).

## Stack

- **React 18** (Create React App / `react-scripts` 5)
- **Redux Toolkit** + `redux-persist` for state and session rehydration
- **React Router 6** for routing
- **React-Bootstrap 5** for accessible dialogs, forms, and dropdowns
- **recharts** for the package rating graph

## Local development

Start the API first (see [`../worker`](../worker)), then:

```bash
npm ci
REACT_APP_REGISTRY_API_URL=http://localhost:8787 npm start
```

The app opens at <http://localhost:3000>. `REACT_APP_REGISTRY_API_URL` is
inlined at **build** time, so changing it requires a restart.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm start` | Dev server with hot reload |
| `npm test` | Interactive test runner |
| `npm run build` | Production bundle in `build/` |
| `npm run deploy` | Build and deploy to Cloudflare Pages |
| `npm run preview` | Build and serve locally with `wrangler pages dev` |

## Design system

Colour, type, space, radius, elevation and motion are defined once as CSS
custom properties in [`src/theme/tokens.css`](src/theme/tokens.css). Components
must reference a token rather than a literal value.

- [`THEME.md`](THEME.md) explains the palette and the token layer.
- `src/theme/tokens.css` is **generated** — edit `tools/palette.py` and run
  `python3 tools/build_tokens.py`, then commit both files.
- [`frontend/docs/theme-contrast.md`](docs/theme-contrast.md) records the
  measured WCAG contrast ratios.

## Accessibility checks

Small dependency-free probes live in `tools/` and are run in CI:

```bash
python3 tools/build_tokens.py --check   # tokens match the generator
node tools/route-smoke.cjs              # every route renders
node tools/modal-a11y.cjs               # dialogs are labelled and focus-trapped
```

## Deployment

The frontend is deployed to Cloudflare Pages. See the canonical
[deployment runbook](../DEPLOYMENT.md) for the full free-tier setup.
