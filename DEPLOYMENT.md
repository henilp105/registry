# Deployment Runbook — fpm Registry

**Architecture:** Cloudflare Workers (Free) + Durable Objects + MongoDB Atlas M0 (Free) + R2 + GitHub
Actions.

**Running cost: $0.00/month.** Every service is on a free tier. The limits that actually constrain
the design are listed in [§9](#9-free-tier-budget); exceeding one returns an error rather than
raising a bill, so a mistake costs availability, never money.

> This replaces the manual SSH deployment on `v2.0.1`, which read *"SSH to the server and run
> `docker compose …`"*. Deployment is now `wrangler deploy` from CI, and rollback is one command.

---

## 1. One-time setup

```bash
# 1. Authenticate. Opens a browser; the token is stored in ~/.wrangler/config.
npx wrangler login

# 2. Create the backing resources. All are on the free tier.
npx wrangler r2 bucket create fpm-registry-tarballs
npx wrangler r2 bucket create fpm-registry-tarballs-preview
npx wrangler kv namespace create CACHE        # paste the id into wrangler.jsonc

# 3. Set secrets. These are NEVER in wrangler.jsonc.
npx wrangler secret put JWT_SECRET_KEY       # node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npx wrangler secret put VALIDATION_SECRET    # node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npx wrangler secret put BREVO_API_KEY         # optional; verification emails are skipped without it
```

### Required GitHub configuration

| Where | What | Why |
|---|---|---|
| Secrets → `VALIDATION_SECRET` | same value as the Worker secret | GitHub Actions authenticates to the validation API with it |
| Secrets → `REGISTRY_API_URL` | e.g. `https://registry-api.fortran-lang.org` | same |
| Variables → `REGISTRY_API_URL` | same URL | read by the non-secret context |
| Secrets → `CLOUDFLARE_API_TOKEN` | a token with Workers *edit* | lets CI deploy |
| Secrets → `CLOUDFLARE_ACCOUNT_ID` | account id | same |

The frontend has one variable, `REACT_APP_REGISTRY_API_URL`, and it is inlined at **build** time by
CRA's `DefinePlugin`. Changing it means a rebuild, not a restart.

---

## 2. Deploying

```bash
# Preview: a separate Worker, separate R2 bucket, separate KV namespace.
npm run deploy:staging

# Production
npm run deploy:production
```

Roll out progressively with the Cloudflare versions system rather than all at once:

```bash
npx wrangler versions upload                       # upload without routing traffic
npx wrangler versions view                        # confirm it built
npx wrangler versions deploy <version-id>@10       # 10% of requests
npx wrangler versions deploy <version-id>@100      # 100% once satisfied
```

---

## 3. Rollback

**Under 60 seconds, and it does not touch the database.**

```bash
# What is live right now?
npx wrangler versions list

# Send 100% of traffic back to the previous version
npx wrangler rollback
```

Every deploy is an immutable version, so rollback never involves rebuilding anything. The Worker is
stateless — all durable state lives in MongoDB and R2, neither of which a Worker rollback touches.

If the Worker is broken badly enough that it is not serving at all, the fastest fix is to stop
routing to it: point the hostname back at the legacy deployment in the Cloudflare DNS record, which
takes effect in seconds.

---

## 4. Cutover from the legacy deployment

The legacy stack is Docker Compose behind nginx. Cutover is a traffic change, not a data migration,
because **the target database has never held registry data** — verified: `cluster0.kdreahb` contains
only `admin`, `local` and the `sample_mflix` sample. So there is no dual-write, no backfill, and no
reconciliation window.

| Step | Action | Gate to proceed |
|---|---|---|
| 0 | Deploy the Worker to staging. Point a staging hostname at it. | `/health` returns 200 with `mongo.connected: true` |
| 1 | Load data into the target cluster. Small enough to do by hand for a soft launch. | `/packages?query=fortran` returns results |
| 2 | Canary at 10% at Cloudflare, with the legacy origin as fallback. | Error rate and p95 within SLO for 24 h |
| 3 | 50%. | 24 h clean. Confirm ratings and uploads work end to end. |
| 4 | 100%. | Keep the legacy stack up, untouched, for 7 days. |
| 5 | Decommission the legacy stack. | — |

**Rollback at any step: `npx wrangler rollback`, or repoint DNS.** The legacy stack is still running
and unmodified throughout, because it is never mutated — the Worker reads the *new* cluster.

### What cannot be rolled back

One thing, stated plainly: **MongoDB writes are not transactional with respect to a Worker
rollback.** A package published while version *N* is live stays published if you roll back to
*N-1*. This is inherent to moving the write path to a new datastore, and it is why step 1 loads data
by hand rather than pointing the Worker at the production cluster.

---

## 5. Validating a deployment

```bash
# The API is alive and MongoDB is reachable through the Durable Object
curl -s $API/health | jq

# The generated OpenAPI document is valid and complete
curl -s $API/apidocs/openapi.json | jq '.openapi, (.paths | length)'

# CORS fails closed: an unknown Origin gets no Access-Control-Allow-Origin
curl -si -H 'Origin: https://evil.example' $API/packages | grep -ci 'access-control-allow-origin'  # 0

# Auth works, and a wrong password is indistinguishable from an unknown account
curl -s -X POST $API/auth/login -F user_identifier=nobody -F password=wrong | jq -r .message
# -> "Invalid email or password"

# The edge cache is working
curl -si $API/packages/stdlib/json-fortran | grep -i x-cache   # HIT on a repeat
```

---

## 6. Monitoring

Free tiers give you Workers Logs, Analytics and Metrics. There is no error-tracking SaaS here,
because there is no budget for one — so `console.error` goes to Workers Logs, which is where the
`logger` in `src/lib/logger.ts` writes.

What to watch:

| Signal | Where | Means |
|---|---|---|
| `Error 1102` | invocation outcomes | Worker exceeded 10 ms CPU. Something is doing heavy work in a handler. |
| `Error 1027` | invocation outcomes | Over 100,000 requests/day. The free tier is exhausted. |
| `exceededCpu` rate | Metrics → Invocation Statuses | The margin above is eroding even without hard failures. |
| `/health` → `degraded` | the endpoint itself | MongoDB unreachable from the pool. |
| R2 usage | `GET /tarballs/usage` | Approaching the 10 GB ceiling. |

**Invoke alerts on:** `mongo.connected == false` from `/health`, and R2 usage above 8 GB. Both are
cheap to poll from GitHub Actions on a cron, which is free.

---

## 7. Routine operations

| Task | How | Cost |
|---|---|---|
| Add an admin | Sign up with the `SUDO_PASSWORD` value **while the users collection is empty**, then promote with `db.users.updateOne({username}, {$set:{roles:["admin"]}})`. | — |
| Revoke a leaked upload token | `POST /namespaces/{ns}/uploadToken/{id}/revoke` | — |
| Add a package | `fpm publish --token <token> --registry <api>` | — |
| Verify packages | Automatic, every 30 min, via GitHub Actions | free |
| Rotate `JWT_SECRET_KEY` | `wrangler secret put`, redeploy. **Invalidates every session.** | — |
| Rotate `VALIDATION_SECRET` | Update the Worker secret **and** the GitHub secret in the same step; validation pauses if they disagree. | — |
| Rebuild the schema | Hourly cron is idempotent; or force it with a manual cron trigger. | — |
| Download a registry snapshot | `GET /registry/archives` | free egress |

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Every request fails with 1102 | CPU-bound work in a handler | Check what was added. The KDF and MongoDB belong in the Durable Object. |
| Login returns 500 | The pool cannot authenticate to Atlas | Check `MONGO_URI` and that the DB user is not IP-restricted to the old host's IP. |
| Uploads 401 with a valid token | The token is expired, revoked, or scoped to another package | `GET /internal/validation/pending` will show it; check `expires_at`. |
| Uploads 501 | Storage migration not deployed | Deploy the current branch. |
| Packages not appearing after publish | Cached search results | Expected to clear within 120 s. If it persists, the version key is version-stamped. |
| Validation never runs | `VALIDATION_SECRET` mismatch | Check the Worker secret and the GitHub secret match. The health job reports this. |
| Verification emails never arrive | `BREVO_API_KEY` unset, or the daily cap hit | Brevo's free tier is 300/day. `GET /health` is unaffected. |

---

## 9. Free-tier budget

| Resource | Allowance | Design headroom |
|---|---|---|
| Worker requests | 100,000 / day | Cache-first; target >80% served at the edge |
| Worker CPU | 10 ms / invocation | KDF and the Mongo connection both moved to the Durable Object |
| Durable Objects | 100,000 / day, 30 s CPU | ~1 s wall per request available |
| Workers KV | 100k reads, 1k writes / day, 1 GB | Cache-invalidation tokens only |
| R2 | 10 GB-month, free egress | ~10,000 typical fpm tarballs |
| MongoDB M0 | 100 ops/sec, 512 MB, 10 GB/7-day egress | Metadata only; tarballs never touch it |
| GitHub Actions | free on public repositories | Validation every 30 min |
| Cron Triggers | 5 / account | 4 in use |

---

## 10. Things that will surprise you

- **Password hashing and the MongoDB connection both live in a Durable Object**, not the Worker.
  PBKDF2 at 210,000 iterations measures 176 ms — roughly 18× the Worker's entire CPU budget. This is
  not premature optimisation; without it, every login returns error 1102.
- **`/packages` uses the `$text` index.** `v2.0.1` created that index and then never used it,
  searching with unescaped `$regex` over full README files instead.
- **`ver.isDeprecated` and `ver.is_deprecated` are both emitted.** The frontend compares the former
  against the string `"true"`, the backend stores the latter as a boolean.
- **A cache hit does not bypass the Worker.** The routing logic lives in it. What a hit avoids is the
  MongoDB round trip — which is what keeps the Atlas M0 operations/sec cap intact.