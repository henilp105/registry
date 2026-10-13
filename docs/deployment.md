# Deployment Guide

The registry is deployed **serverless** — there is no VM, Docker Compose, or nginx to run.

👉 **Current runbook: [`DEPLOYMENT.md`](../DEPLOYMENT.md) at the repository root.**

## What changed from the self-hosted stack

The last self-hosted release (`v2.0.1`) ran Flask behind nginx in Docker Compose. That
stack has been removed from this repository as part of the serverless migration.

| | Legacy (`v2.0.1`) | Current |
|---|---|---|
| Hosting | One or more VMs, Docker Compose, nginx | Cloudflare Workers, no servers |
| Deploy | SSH to the host, `docker compose up -d --build` | `npx wrangler deploy`, or CI |
| Rollback | `git reset --hard` on the host, rebuild, restart | `npx wrangler rollback`, under 60 s |
| Scaling | Vertical, manual | Automatic at the edge |
| Cost | Whatever the VM costs | **$0.00/month**, all free tiers |
| Secrets | `.env` on the server | `wrangler secret put`, never on disk |
| MongoDB | Self-hosted | MongoDB Atlas M0, free tier |
| Artifacts | Container filesystem, lost on redeploy | R2, versioned and durable |

The migration rationale, the measured constraints that forced each decision, and the
rejected alternatives are in
[`SERVERLESS_MIGRATION_PLAN.md`](./SERVERLESS_MIGRATION_PLAN.md). The API surface is
unchanged; [`API_CONTRACT.md`](./API_CONTRACT.md) is the frozen contract, and
`/apidocs/openapi.json` serves it generated from the code so the two cannot drift.
