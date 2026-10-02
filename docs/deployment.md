# Deployment Guide

**This guide has moved.** The Docker Compose / nginx deployment described here is the *legacy* stack.
It is no longer how the registry is deployed.

Current deployment runbook: **[`DEPLOYMENT.md`](../DEPLOYMENT.md)** at the repository root.

## What changed

| | Legacy (`v2.0.1`) | Current |
|---|---|---|
| Hosting | One or more VMs, Docker Compose, nginx | Cloudflare Workers, no servers |
| Deploy | SSH to the host, `docker compose up -d --build` | `npx wrangler deploy`, or CI |
| Rollback | `git reset --hard` on the host, rebuild, restart | `npx wrangler rollback`, under 60 s |
| Scaling | Vertical, manual | Automatic at the edge |
| Cost | Whatever the VM costs | **$0.00/month**, all free tiers |
| Secrets | `.env` on the server | `wrangler secret put`, never on disk |
| MongoDB | Self-hosted, 512 MB VPS | MongoDB Atlas M0, free tier |
| Artifacts | Container filesystem, lost on redeploy | R2, versioned and durable |

The migration rationale, the measured constraints that forced each decision, and the rejected
alternatives are in [`docs/SERVERLESS_MIGRATION_PLAN.md`](./SERVERLESS_MIGRATION_PLAN.md). The API
surface is unchanged; [`docs/API_CONTRACT.md`](./API_CONTRACT.md) is the frozen contract, and
`/apidocs/openapi.json` serves it generated from the code so the two cannot drift.

## Why the legacy guide is kept

The legacy stack is still the rollback target for the first 7 days after cutover, so the procedure for
restarting it is not worthless yet:

```bash
cd /opt/registry/backend
git pull
docker compose -f compose.yaml -f compose.override.yaml up -d --build backend
```

After cutover is complete and the legacy stack is decommissioned, delete this file.