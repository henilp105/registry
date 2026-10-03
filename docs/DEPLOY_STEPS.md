# Serverless Deployment Guide — fpm Registry

Free-tier hosting: Cloudflare Workers (API) + Cloudflare R2 (tarballs) +
Cloudflare KV (cache/rate-limit) + MongoDB Atlas M0 (database) + Cloudflare
Pages (frontend). No servers, no build cost.

Prerequisites: Node ≥ 22, npm, `git`, a Cloudflare account (free), a MongoDB
Atlas M0 cluster. The PAT for this repo is configured in the git remote.

---

## 0. Clone / update

```bash
git clone https://github.com/henilp105/registry.git
cd registry
git checkout main
git pull origin main
```

## 1. Create the free Cloudflare resources (once)

```bash
cd worker
npx wrangler login                      # OAuth in browser
npx wrangler kv namespace create fpm_registry_cache
#  -> copy the printed "id" into worker/wrangler.jsonc (CACHE binding)
npx wrangler r2 bucket create fpm-registry-tarballs
```

Edit `worker/wrangler.jsonc`:

- replace `REPLACE_WITH_KV_NAMESPACE_ID` with the id from the previous step
- set `"name"` for the worker, and `ALLOWED_ORIGINS` to your frontend origin
  (e.g. `https://fpm-registry.pages.dev`)

## 2. Set secrets (never commit these)

```bash
npx wrangler secret put MONGO_URI
# paste: mongodb+srv://henilp105_db_user:FsPIM1HkOairYjZj@cluster0.kdreahb.mongodb.net/?appName=Cluster0

npx wrangler secret put JWT_SECRET_KEY
# paste a random string: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npx wrangler secret put VALIDATION_SECRET
# another random string (mail verification tokens)

npx wrangler secret put BREVO_API_KEY   # optional: leave empty to disable mail
```

## 3. Type-check, lint, and unit-test

```bash
npm ci
npx tsc --noEmit
npm run lint
npm test
```

## 4. Dry-run deploy (validates bindings/bundles without publishing)

```bash
npx wrangler deploy --dry-run
```

## 5. Deploy the API

```bash
npx wrangler deploy
# prints the workers.dev URL, e.g. https://fpm-registry-api.<account>.workers.dev
```

Sanity-check:

```bash
curl https://fpm-registry-api.<account>.workers.dev/health
curl -sS https://fpm-registry-api.<account>.workers.dev/apidocs/openapi.json | head
```

## 6. Deploy the frontend (Cloudflare Pages)

```bash
cd ../frontend
# bake the real API origin into the bundle at build time
export REACT_APP_REGISTRY_API_URL=https://fpm-registry-api.<account>.workers.dev
npm ci
npm run build
npx wrangler pages deploy build --project-name=fpm-registry
# prints the Pages URL, e.g. https://fpm-registry.pages.dev
```

## 7. Wire CORS to the real frontend origin

Back in `worker/wrangler.jsonc`, set:

```jsonc
"ALLOWED_ORIGINS": "https://fpm-registry.pages.dev"
```

then redeploy:

```bash
cd ../worker
npx wrangler deploy
```

## 8. Verify end-to-end

```bash
curl -sS -X POST https://fpm-registry-api.<account>.workers.dev/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"smoke","email":"you@example.com","password":"..."}'
curl -sS "https://fpm-registry-api.<account>.workers.dev/search?query=fpm"
```

Open `https://fpm-registry.pages.dev`, register, publish a package, and
download the tarball — the full free-tier loop.

## 9. CI notes

`.github/workflows/worker.yml` runs tests and `wrangler deploy --dry-run` on
every push; the Pages deploy can be wired to push-to-`main` with the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets if you want
manual `wrangler pages deploy` runs to be optional.
