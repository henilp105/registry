# Deploying the fpm Registry (serverless, free tier)

Target shape on the free plans:

| Piece | Service | Free-tier limits |
| --- | --- | --- |
| API (`worker/`) | Cloudflare Workers + Durable Objects | 100k req/day, 10 ms CPU |
| MongoDB | MongoDB Atlas M0 | 512 MB, shared |
| Tarballs | Cloudflare R2 | 10 GB, free egress |
| Cache/KV | Cloudflare KV | 100k reads/day |
| Frontend | Cloudflare Pages (static build) | unlimited |

Prerequisites: Node ≥ 22, a Cloudflare account (free), an Atlas cluster
(M0), and the repo cloned with your PAT configured.

---

## 1. Install Wrangler

```bash
npm install -g wrangler
wrangler --version        # must be >= 4.x
```

## 2. Authenticate

```bash
wrangler login            # opens a browser; authorize the CLI
```

## 3. Create the KV namespace and R2 bucket

```bash
wrangler kv namespace create fpm_registry_cache
# -> copy the printed id into worker/wrangler.jsonc:
#    "id": "REPLACE_WITH_KV_NAMESPACE_ID"   (development)
#    "id": "REPLACE_WITH_STAGING_KV_NAMESPACE_ID" / "REPLACE_WITH_PRODUCTION_KV_NAMESPACE_ID" (in the env sections)

wrangler r2 bucket create fpm-registry-tarballs
```

## 4. Set secrets (never commit these)

```bash
cd worker
wrangler secret put MONGO_URI
# paste: mongodb+srv://henilp105_db_user:FsPIM1HkOairYjZj@cluster0.kdreahb.mongodb.net/?appName=Cluster0

wrangler secret put JWT_SECRET_KEY        # generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
wrangler secret put VALIDATION_SECRET     # different random string, same command
wrangler secret put BREVO_API_KEY         # free-tier Brevo key, or leave unset to disable mail
```

## 5. Verify the config renders correctly

```bash
node ../scripts/check_deploy_ready.mjs
wrangler deploy --dry-run
```

## 6. Deploy the API

```bash
wrangler deploy                 # development default from wrangler.jsonc
# or, for an environment section:
wrangler deploy --env production
```

## 7. Point the frontend at the API and publish it

```bash
cd ../frontend
REACT_APP_REGISTRY_API_URL=https://fpm-registry-api.<your-subdomain>.workers.dev npm ci && npm run build

npx wrangler pages deploy build --project-name fpm-registry
```

## 8. Smoke-test the deployment

```bash
curl https://fpm-registry-api.<your-subdomain>.workers.dev/health
curl "https://fpm-registry-api.<your-subdomain>.workers.dev/search?query=test"
node ../scripts/check_api_compat.py --base-url https://fpm-registry-api.<your-subdomain>.workers.dev
```

## 9. Roll back if anything breaks

```bash
wrangler rollback        # reverts to the previous Worker version
```
