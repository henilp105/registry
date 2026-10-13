# fpm-registry-api

The FPM Registry API: a Cloudflare Worker (TypeScript) backed by a Durable Object that
owns the MongoDB Atlas connection, with package tarballs in R2 and hot metadata in KV.

## Why a Durable Object?

The Workers **free** plan allows **10 ms of CPU per request**. Two unavoidable costs blow
through that budget if they run in the handler:

| Cost | Measured | Budget |
|------|----------|--------|
| One PBKDF2-SHA256 round of MongoDB's SCRAM handshake | ~4.5 ms | 10 ms |
| Password KDF at 10,000 iterations | ~8.5 ms | 10 ms |

A Durable Object gets **30 s of CPU per request** on the same free plan, so the connection
is opened once and the KDF runs there. `POST /auth/login` and `POST /packages` would return
Cloudflare **error 1102** on every call without this split. See
`../docs/SERVERLESS_MIGRATION_PLAN.md` for the full measurement and rationale.

## Layout

```
src/
├── index.ts        Worker entry — CORS, rate limiting, health, cron dispatch
├── router.ts       Route table (method-first matching; see the ordering note)
├── routes/         auth, users, namespaces, packages, ratings, tarballs, archives, …
├── lib/            jwt, password, upload-tokens, cache, validators, storage, openapi, …
└── db/             mongo-pool (Durable Object), client, bson (RPC conversion), indexes
```

## Commands

```bash
npm ci
npm run dev         # wrangler dev → http://localhost:8787
npm run typecheck   # tsc, both projects
npm run lint        # eslint src test
npm test            # vitest
npm run format      # prettier --write src test
```

## Local configuration

```bash
cp .dev.vars.example .dev.vars
# MONGO_URI, JWT_SECRET_KEY, SALT — .dev.vars is gitignored, never commit it
```

## Deployment

```bash
npm run deploy:staging
npm run deploy:production
```

The full runbook — creating KV/R2 resources, setting secrets, smoke tests, and rollback —
is in [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

## API contract

Every response follows one rule:

- **success** → HTTP 2xx and a body containing `code: 200`
- **failure** → HTTP non-2xx and a body `{ code, message }`

The frozen surface is [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md). The Worker
generates its own OpenAPI 3.1 document at `/apidocs/openapi.json`, so the code and the spec
cannot drift.
