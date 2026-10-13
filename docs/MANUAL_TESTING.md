# Manual Testing Runbook — FPM Registry

A step-by-step checklist for verifying the **whole** registry — not just that it is
up, but that every published feature still works — **before and after a deploy**,
and quickly enough to catch a regression before it becomes downtime.

Everything here is expressible as a direct API call. `fpm` is exercised for real in
[§4](#4-fpm-end-to-end), but the authoritative checks are `curl`: if the bytes the
CLI sends are wrong, the raw calls will say so, whereas a passing `fpm publish`
can hide a response the frontend depends on.

> **Scope.** Covers the Worker API (`worker/`), the R2 artifact path, the
> validation callback, and the React frontend. It does not re-derive the frozen
> contract; that is [`API_CONTRACT.md`](API_CONTRACT.md).

---

## 0. How to use this document

There are two shapes of run:

| Run | When | Sections | Target time |
|---|---|---|---|
| **Smoke** | Every deploy, on the canary | §1 → §2 | ≤ 3 min |
| **Full** | Before a production cutover, weekly, or after touching a route | §1 → §8 | ≤ 45 min |

Work top to bottom. A failure in an early section means **stop** — later results
are not trustworthy while the foundation is broken.

### 0.1 The one rule that matters

> **Success is HTTP `2xx` *and* JSON body `code: 200`.**
> **Failure is HTTP non-`2xx` *and* body `{ code, message }`.**

A `200` with `code: 401` in the body is a **failure**, even though the transport
looked fine. That exact class of bug (HTTP 200 carrying a non-200 `code`) is defect
D14 in [`BASELINE_AUDIT.md`](BASELINE_AUDIT.md), and it is why every check below
asserts on **both** the status and the body.

### 0.2 Environment

Pick one target and keep it for the whole run. Never run the destructive checks
(§3.5 delete, §3.4 namespace delete, §3.9 validation) against production without a
throwaway namespace.

```bash
# ── choose ONE ────────────────────────────────────────────────────────────────
export API="https://registry.fortran-lang.org"           # production
# export API="https://staging.registry.fortran-lang.org" # staging
# export API="http://127.0.0.1:8787"                     # local wrangler dev

# A unique namespace per run, so cleanup is a single delete and runs never
# collide. Namespace charset is [A-Za-z0-9._-]; keep it lowercase.
export RUN="$(date +%s)"
export NS="qans${RUN}"
export USER="qauser${RUN}"
export EMAIL="qauser${RUN}@example.invalid"
export PASS='Qa-Password-1234'

echo "API=$API  NS=$NS  USER=$USER"
```

Tools used: `curl`, `jq`, `gzip`, `tar`, `openssl`. All standard.

```bash
command -v curl jq gzip tar openssl >/dev/null || echo "install the missing tool(s)"
```

### 0.3 A helper for the two-part rule

Sourcing this makes the checklist terser and the assertions exact. It is optional;
every command below also shows the raw `curl`.

```bash
# api <expected_status> <method> <path> [curl args...]
# Prints the body and fails loudly when either half of the rule is violated.
api() {
  local want="$1" method="$2" path="$3"; shift 3
  local out status body
  out="$(curl -sS -X "$method" -w $'\n%{http_code}' "$API$path" "$@")"
  status="${out##*$'\n'}"; body="${out%$'\n'*}"
  local code; code="$(jq -r '.code // empty' <<<"$body" 2>/dev/null)"
  printf '%s HTTP %s body.code %s\n' "$path" "$status" "${code:-<none>}"
  if [[ "$status" != "$want" ]]; then
    printf '  ✗ expected HTTP %s\n%s\n' "$want" "$body"; return 1
  fi
  if [[ "$want" == 2* && "$code" != "200" ]]; then
    printf '  ✗ 2xx but body.code != 200\n%s\n' "$body"; return 1
  fi
  printf '%s\n' "$body"
}
```

Note: `curl -sS` shows errors but not progress; `-f` is deliberately **not** used
because a non-2xx is expected on the negative tests and we want the body.

---

## 1. Pre-deploy gate (never ship a regression)

Run these **before** `wrangler deploy`. They are the same gates CI runs
(`.github/workflows/worker.yml`) plus the deploy-readiness config check.

| # | Check | Command | Must see |
|---|---|---|---|
| 1.1 | Typecheck both TS projects | `cd worker && npm run typecheck` | exit 0 |
| 1.2 | Lint | `cd worker && npm run lint` | exit 0 |
| 1.3 | Unit / contract tests | `cd worker && npm test` | all pass |
| 1.4 | Bundle + binding resolution | `cd worker && npx wrangler deploy --dry-run --outdir=dist` | no error; `dist/` written |
| 1.5 | Regenerate types from `wrangler.jsonc` | `cd worker && npx wrangler types` | exit 0 |
| 1.6 | Deploy config completeness | `node scripts/check_deploy_ready.mjs production` | **all 10 checks pass** |
| 1.7 | Frozen contract docs present | `test -s docs/API_CONTRACT.md && test -s docs/BASELINE_AUDIT.md && test -s docs/SERVERLESS_MIGRATION_PLAN.md` | exit 0 |
| 1.8 | No credential in tracked source | `node scripts/check_no_secrets.mjs` | exit 0 |
| 1.9 | No shell-interpolated subprocess (py) | `node scripts/check_no_shell_injection.mjs` | exit 0 |
| 1.10 | Validator unit tests | `python -m pytest scripts/test_validate_packages.py -q` | all pass |
| 1.11 | Frontend source invariants | `node scripts/check_store_helpers.mjs` (root) and `(cd frontend && node ../scripts/check_form_labels.mjs && node ../scripts/check_session_reset.mjs)` | exit 0 |

**Known-benign red on a fresh clone.** `check_deploy_ready.mjs` fails 2 of 10 until
the KV namespace ids are pasted into `wrangler.jsonc` (they are `REPLACE_WITH_*`
placeholders). That is expected before step 2 of the one-time setup in
[`../DEPLOYMENT.md`](../DEPLOYMENT.md). Every other check must pass. Likewise the
`Validate Packages` workflow is red until `REGISTRY_API_URL` and
`VALIDATION_SECRET` are set — it is a cron, not a push gate, and says nothing about
a commit.

### 1.12 Optional but recommended: full automated write-path sweep

Against a running staging/local Worker with a database you are willing to mutate:

```bash
node scripts/write_path_audit.mjs "$API"   # 69 assertions across the write half
node scripts/write_journey.cjs             # end-to-end publish/consume journey
node scripts/auth_journey.cjs              # auth flow
node scripts/member_journey.cjs            # maintainer/admin role flow
node scripts/token_journey.cjs             # upload-token lifecycle
node scripts/rate_limit_probe.cjs          # limits actually enforced
```

These need a MongoDB URI (`MONGODB_TEST_URI`, else `MONGO_URI`) and will refuse to
run without one — deliberately, so a harness never silently skips its checks.

---

## 2. Post-deploy smoke (catch downtime in ≤ 3 minutes)

Runs immediately after routing traffic to a new version. **Every item must pass
before you raise the canary weight.** If any fails, go to §8 (rollback).

> **Runnable form.** `scripts/smoke.sh` performs 2.1–2.7 as one read-only command
> (it never publishes or deletes) and exits non-zero on the first failure. It is a
> direct-`curl` harness, so it needs nothing but `curl` and `jq`:
>
> ```bash
> API="$API" ALLOWED_ORIGIN="https://registry.fortran-lang.org" scripts/smoke.sh
> ```
>
> Run it, then read the matching subsection below to diagnose anything it flags.

### 2.1 Liveness and database reachability

```bash
curl -sS "$API/health" | jq
```

Expected — HTTP 200 and body:

```json
{
  "code": 200,
  "service": "fpm-registry-api",
  "status": "healthy",
  "version": "3.0.0",
  "environment": "production",
  "mongo": { "connected": true, "checked": true, "serverVersion": "8.0.x" },
  "ts": "2026-10-13T12:00:00.000Z"
}
```

- `"status": "healthy"` **and** `mongo.connected: true` → pass.
- `"status": "degraded"` with `mongo.connected: false` → **fail**: MongoDB is
  unreachable through the Durable Object. `/health` still answers `200` on purpose
  (a DB blip must not make the edge itself look dead), so **you must read
  `mongo.connected`** — the HTTP status alone is not enough.
- `/health` is exempt from rate limiting, so it is safe to poll.

Deeper probe (same payload), for a monitor that prefers `/healthz`:

```bash
curl -sS "$API/healthz" | jq '.status, .mongo.connected'
```

### 2.2 Read path (the API serves a package)

```bash
curl -sS "$API/packages?query=fortran&page=0" | jq '{code, total_pages, n: (.packages|length), first: .packages[0]}'
```

Expected: `code: 200`, `packages` an array (possibly empty on a fresh staging DB),
`total_pages` a number ≥ 0. A non-empty staging DB should show real entries.

If this throws a `text index required` error, the hourly bootstrap has not yet run
and the lazy self-heal did not fire — see §7.4.

### 2.3 Docs endpoints

```bash
curl -sS "$API/" | jq
curl -si "$API/apidocs" | head -1
curl -sS "$API/apidocs/openapi.json" | jq '.openapi, (.paths | length)'
```

Expected: `{"code":200,"message":"fpm registry api","version":"3.0.0"}`; `HTTP/1.1 200`;
`"3.1.0"` and a **non-zero** path count (the route table is 40+ routes; a sudden
drop means the generator broke).

### 2.4 CORS fails closed

```bash
curl -si -H 'Origin: https://evil.example' "$API/packages" \
  | grep -ci 'access-control-allow-origin'     # MUST print 0
curl -si -H 'Origin: https://registry.fortran-lang.org' "$API/packages" \
  | grep -i 'access-control-allow-origin'      # MUST echo the origin
```

`supports_credentials` is never sent, so the API is CSRF-immune. A wildcard or a
reflected unknown origin is a **security regression** (defect D-CORS in the audit).

### 2.5 Artifact path (downloads bypass MongoDB)

Only run if a known package exists. On staging, publish one in §4 first.

```bash
curl -sS -D - -o /dev/null "$API/tarballs/fortran-lang/stdlib/0.6.0" | grep -iE 'HTTP/|content-type|x-checksum-sha256'
```

Expected: `HTTP/2 200`, `content-type: application/gzip`, and a
`x-checksum-sha256:` header. A `404` is acceptable if that exact package/version
does not exist on the target — substitute a real one.

### 2.6 Edge cache is active

```bash
curl -si "$API/packages?query=fortran" | grep -i 'x-cache'      # first: MISS
curl -si "$API/packages?query=fortran" | grep -i 'x-cache'      # second: HIT
```

The second call must report a cache hit. If it never does, the KV binding is
missing (usually because `env.production` did not repeat `kv_namespaces` — see
`worker/wrangler.jsonc`).

### 2.7 Rate-limit headers present on non-exempt routes

```bash
curl -si "$API/packages?query=fortran" | grep -iE 'x-ratelimit-(limit|remaining|reset)'
```

Expected: `X-RateLimit-Limit: 100`, a remaining count, a reset epoch. Absent
headers mean the limiter **failed open** (counter store unreachable) — degrade
gracefully, but investigate.

**Smoke sign-off:** all of 2.1–2.7 green → raise the canary weight
(`npx wrangler versions deploy <id>@50`, then `@100`). Any failure → §8.

---

## 3. API checklist (every route, direct calls)

One row per route. Exercises the full surface. **Mutating** steps are marked; run
them against staging or a throwaway namespace.

### 3.0 Bootstrap a test account

Verification email requires `BREVO_API_KEY`. If it is unset (common on staging),
read the token out of the database or set `isVerified` directly. The API **never**
accepts a bare account uuid as proof (defect D2), so there is no API shortcut —
that is the point.

```bash
# 3.0.1 Signup
curl -sS -X POST "$API/auth/signup" \
  -F "username=$USER" -F "email=$EMAIL" -F "password=$PASS" | jq
```
Expect: `{"code":200,"message":"Signup successful. Please verify your email."}`

```bash
# 3.0.2 Unverified login is refused  → HTTP 401
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$API/auth/login" \
  -F "user_identifier=$USER" -F "password=$PASS"          # 401
```

```bash
# 3.0.3 Verify the account (only if you cannot click the emailed link)
#      Uses mongosh against the SAME database the Worker uses (MONGO_DB_NAME).
mongosh "$MONGO_URI" --quiet --eval "
  db.getSiblingDB('$MONGO_DB_NAME').users.updateOne(
    { username: '$USER' }, { \$set: { isVerified: true } }
  )
"
```

```bash
# 3.0.4 Login (verified) → capture the access token
ACCESS="$(curl -sS -X POST "$API/auth/login" \
  -F "user_identifier=$USER" -F "password=$PASS" | jq -r .access_token)"
export ACCESS
test -n "$ACCESS" && test "$ACCESS" != null && echo "got access token"
```

Expected login body: `{code:200, message:"Login successful", access_token, refresh_token, username}`.

> **Durability note.** If this account should survive the run to own a namespace,
> promote it to admin only if the §3.4 namespace-delete / §3.10 user-delete checks
> need a site admin. Otherwise leave it a normal `role: ["user"]` and use a
> separately provisioned admin for the admin-only rows.

### 3.1 Meta

| Method | Path | Auth | Expected |
|---|---|---|---|
| GET | `/` | — | `{code:200, message:"fpm registry api", version:"3.0.0"}` |
| GET | `/health` | — | §2.1 |
| GET | `/apidocs` | — | `{name, version, openapi, docs}` |
| GET | `/apidocs/openapi.json` | — | OpenAPI 3.1 document |
| GET | `/latency` | — | **404** (retired Flask endpoint) |

```bash
curl -sS "$API/" | jq -e '.code==200 and .version=="3.0.0" and .message=="fpm registry api"'
curl -sS -o /dev/null -w '/latency HTTP %{http_code}\n' "$API/latency"   # 404
```

### 3.2 Auth (8 routes + 1 redirect)

| Method | Path | Form fields | Auth | Expected |
|---|---|---|---|---|
| POST | `/auth/signup` | `username`,`email`,`password` | — | `{code:200,message}` |
| POST | `/auth/login` | `user_identifier`,`password` | — | `{code:200,access_token,refresh_token,username}` |
| POST | `/auth/logout` | *(none)* | Bearer | `{code:200,message:"Logout successful"}` |
| POST | `/auth/refresh` | `refresh_token` | — | `{code:200,access_token,refresh_token}` |
| POST | `/auth/forgot-password` | `email` | — | `{code:200,message}` (same for unknown) |
| POST | `/auth/reset-password` (A) | `oldpassword`,`password` | Bearer | `{code:200,message:"Password reset successful"}` |
| POST | `/auth/reset-password` (B) | `password`,`uuid` | — | same, `uuid` = emailed single-use token |
| POST | `/auth/verify-email` | `uuid` | — | `{code:200,access_token,refresh_token}` |
| POST | `/auth/change-email` | `new_email` | Bearer | `{code:200,message:"Please verify your new email."}` |
| GET | `/auth/reset-password` | — | — | `302` redirect to `HOST` |

```bash
# refresh: proves the refresh-token store works (new in this migration)
REFRESH="$(curl -sS -X POST "$API/auth/login" \
  -F "user_identifier=$USER" -F "password=$PASS" | jq -r .refresh_token)"
curl -sS -X POST "$API/auth/refresh" -F "refresh_token=$REFRESH" \
  | jq -e '.code==200 and (.access_token|length>0) and (.refresh_token|length>0)'

# forgot-password: unknown address must be indistinguishable from a real one
curl -sS -X POST "$API/auth/forgot-password" -F "email=nobody-${RUN}@example.invalid" \
  | jq -e '.code==200'
```

The last check is a **security assertion**: an unknown address must not return
`404`. Same message, same status, or it is an enumeration oracle.

### 3.3 Users

| Method | Path | Auth | Expected |
|---|---|---|---|
| GET | `/users/{username}` | — | `{code:200,message:"User found",user{username,createdAt},packages[],namespaces[]}` |
| GET | `/users/{username}` (self, Bearer) | Bearer | same, **plus `user.email`** |
| POST | `/users/account` | Bearer | `{code:200,user:{username,email,createdAt,loginAt,lastLogout}}` |
| POST | `/users/admin` | Bearer admin | `{code:200,message:"User is admin",isAdmin:"true"}` |
| POST | `/users/delete` | Bearer admin | `{code:200,message:"User deleted"}` |
| POST | `/users/admin/transfer` | — | `501` `"This Functionality has been disabled."` |

```bash
# public profile must NOT contain an email
curl -sS "$API/users/$USER" | jq -e '
  .code==200 and (.user|has("username")) and ((.user|has("email"))|not)
'
# self profile MUST contain the email (Bearer)
curl -sS -H "Authorization: Bearer $ACCESS" "$API/users/$USER" \
  | jq -e '.user.email == env.EMAIL'

# isAdmin is the STRING "true" for an admin, and absent/forbidden otherwise
curl -sS -H "Authorization: Bearer $ACCESS" -X POST "$API/users/admin" | jq

curl -sS -H "Authorization: Bearer $ACCESS" -X POST "$API/users/account" \
  | jq -e '.code==200 and (.user.createdAt|type=="string") and ((.user.createdAt|length)>=16)'

curl -sS -o /dev/null -w 'transfer HTTP %{http_code}\n' \
  -X POST "$API/users/admin/transfer"          # 501
```

`createdAt` **must be a string ≥ 16 chars** — the frontend calls
`.slice(0,16)` and a BSON `Date` serialised as `{}` crashes the UI.

### 3.4 Namespaces

| Method | Path | Form fields | Auth | Expected |
|---|---|---|---|---|
| POST | `/namespaces` | `namespace`,`namespace_description` | Bearer | `{code:200,message:"Namespace created successfully"}` |
| GET | `/namespace/{ns}` | — | — | `{code:200,createdAt,description,packages[]}` |
| POST | `/namespaces/{ns}/uploadToken` | — | Bearer | `{code:200,uploadToken,upload_token,expires_in_days:7}` |
| POST | `/namespaces/{ns}/uploadToken/{id}/revoke` | — | Bearer | `{code:200,message:"Upload token revoked"}` |
| POST | `/namespaces/{ns}/admins` | — | — | `{code:200,users:[{id,username}]}` |
| POST | `/namespaces/{ns}/maintainers` | — | — | `{code:200,users:[{id,username}]}` |
| POST | `/namespace/{ns}/delete` | — | Bearer site admin | `{code:200,message:"Namespace deleted successfully"}` |

```bash
curl -sS -X POST "$API/namespaces" -H "Authorization: Bearer $ACCESS" \
  -F "namespace=$NS" -F "namespace_description=QA namespace $RUN" \
  | jq -e '.code==200'

# singular GET returns the namespace and its packages (empty for now)
curl -sS "$API/namespace/$NS" \
  | jq -e --arg ns "$NS" '.code==200 and (.packages|type=="array")'

# mint a NAMESPACE-scoped publish token (required for the first publish)
UPTOKEN="$(curl -sS -X POST "$API/namespaces/$NS/uploadToken" \
  -H "Authorization: Bearer $ACCESS" | jq -r '.uploadToken // .upload_token')"
export UPTOKEN
test -n "$UPTOKEN" && test "$UPTOKEN" != null && echo "got upload token"
```

The response carries **both** `uploadToken` and `upload_token` — the frontend reads
the former, other clients the latter. Assert both are present and equal (defect
D-7.4):

```bash
curl -sS -X POST "$API/namespaces/$NS/uploadToken" -H "Authorization: Bearer $ACCESS" \
  | jq -e '.upload_token and .uploadToken and (.upload_token==.uploadToken)'
```

### 3.5 Packages (the core)

| Method | Path | Form / query | Auth | Expected |
|---|---|---|---|---|
| GET | `/packages` | `query`,`page` (0-based),`limit`,`sorted_by` | — | `{code:200,packages[],total_pages}` |
| GET | `/packages_cli` | `query`,`namespace`,`package`,`license`,`page` (1-based) | — | `{code:200,packages[]}`; **404** when empty |
| POST | `/packages` | multipart: `upload_token`,`package_name`,`package_version`,`package_license`,`tarball`[,`dry_run`] | token | `{code:200,message:"Package Uploaded Successfully."}` |
| GET | `/packages/{ns}/{pkg}` | — | — | `{code:200,data{…}}` |
| GET | `/packages/{ns}/{pkg}/{version}` | — | — | `{code:200,data{…,version_data}}` |
| PUT | `/packages` | `name`,`namespace`,`isDeprecated` | Bearer | `{code:200,message:"Package deprecated successfully"}` |
| POST | `/packages/{ns}/{pkg}/verify` | — | Bearer | `{code:200,status,isVerified}` |
| GET/POST | `/packages/{ns}/{pkg}/maintainers` | — | — | `{code:200,users:[{id,username}]}` |
| POST | `/packages/{ns}/{pkg}/uploadToken` | — | Bearer | `{code:200,upload_token,uploadToken}` |
| POST | `/packages/{ns}/{pkg}/delete` | — | Bearer site admin | `{code:200,message:"Package deleted successfully"}` |
| POST | `/packages/{ns}/{pkg}/{version}/delete` | — | Bearer site admin | `{code:200,message:"Package version deleted successfully"}` |

#### 3.5.1 Search shape

```bash
curl -sS "$API/packages?query=fortran&page=0&limit=5&sorted_by=updatedat" \
  | jq -e '.code==200 and (.packages|type=="array") and (.total_pages|type=="number")'
```

Each entry must have exactly `name, namespace, description, keywords, updated_at`.
`sorted_by` accepts `"" | name | updatedat | createdat | downloads` and maps
`updatedat→updated_at`, `downloads→download_count`.

#### 3.5.2 The `packages_cli` asymmetry (a real regression trap)

```bash
# a query that matches nothing must be a 404 with status:"error"
curl -sS -o /tmp/cli.json -w '%{http_code}\n' \
  "$API/packages_cli?query=zzz-nothing-${RUN}&page=1"          # 404
jq -e '.status=="error"' /tmp/cli.json
```

`page` is **1-based** here and **0-based** on `/packages`. Getting this backwards
silently duplicates or skips a page. Do not "fix" the inconsistency; the CLI
depends on it.

#### 3.5.3 Upload

Build a minimal valid gzip tarball (the upload path validates name, version, SPDX
license, size and digest — not the Fortran inside, so a JSON manifest is a valid
artifact for a plumbing test):

```bash
export PKG="qa-pkg-${RUN}"
export VER="1.0.0"
printf '{"name":"%s","version":"%s"}' "$PKG" "$VER" > /tmp/manifest.json
tar -czf "/tmp/${PKG}.tar.gz" -C /tmp manifest.json
sha256sum "/tmp/${PKG}.tar.gz"
```

```bash
# 3.5.3a DRY RUN first — must validate the token with no side effects
curl -sS -X POST "$API/packages" \
  -F "upload_token=$UPTOKEN" -F "package_name=$PKG" -F "package_version=$VER" \
  -F "package_license=MIT" -F "dry_run=true" -F "tarball=@/tmp/${PKG}.tar.gz" \
  | jq -e '.code==200 and .message=="Dry run Successful."'
```

Then confirm nothing was persisted:

```bash
curl -sS -o /dev/null -w 'dry-run must not create: HTTP %{http_code}\n' \
  "$API/packages/$NS/$PKG"      # 404
```

A dry run that returns `code:200` but *does* create the package is defect class
D15 (side effects on the dry-run path).

```bash
# 3.5.3b REAL publish
curl -sS -X POST "$API/packages" \
  -F "upload_token=$UPTOKEN" -F "package_name=$PKG" -F "package_version=$VER" \
  -F "package_license=MIT" -F "tarball=@/tmp/${PKG}.tar.gz" \
  | jq -e '.code==200 and .message=="Package Uploaded Successfully."'
```

```bash
# 3.5.3c it is now readable, and the digest matches the file
curl -sS "$API/packages/$NS/$PKG" | jq -e --arg v "$VER" '
  .code==200
  and .data.latest_version_data.version==$v
  and (.data.latest_version_data.download_url|startswith("/"))
  and .data.latest_version_data.is_deprecated==false
  and .data.latest_version_data.isDeprecated=="false"
'
```

Expected `data` keys: `name, namespace, description, registry_description,
homepage, repository, copyright, license, author, keywords, categories,
created_at, updated_at, is_verified, is_malicious, security_status,
unable_to_verify, maintainers, latest_version_data, version_history, ratings,
ratings_count, downloads`.

```bash
# 3.5.3d version endpoint carries version_data
curl -sS "$API/packages/$NS/$PKG/$VER" \
  | jq -e --arg v "$VER" '.code==200 and .data.version_data.version==$v'

# 3.5.3e a near-miss version must NOT match (0.1 vs 0.10.0 class, defect D9)
curl -sS -o /dev/null -w 'wrong version HTTP %{http_code}\n' "$API/packages/$NS/$PKG/1"   # 404

# 3.5.3f duplicate publish is refused
curl -sS -o /dev/null -w 'duplicate HTTP %{http_code}\n' -X POST "$API/packages" \
  -F "upload_token=$UPTOKEN" -F "package_name=$PKG" -F "package_version=$VER" \
  -F "package_license=MIT" -F "tarball=@/tmp/${PKG}.tar.gz"                       # 400
```

#### 3.5.4 Artifact download + checksum

```bash
curl -sS -D /tmp/h.txt -o /tmp/dl.tar.gz "$API/tarballs/$NS/$PKG/$VER"
grep -iE 'HTTP/|content-type|content-disposition|x-checksum-sha256' /tmp/h.txt
```

Expected: `HTTP/2 200`, `content-type: application/gzip`,
`content-disposition: attachment; filename="<pkg>-<ver>.tar.gz"`, and
`x-checksum-sha256:`.

```bash
# The served bytes must match the file we uploaded AND the advertised header.
CSUM="$(grep -i '^x-checksum-sha256:' /tmp/h.txt | tr -d '\r' | awk '{print $2}')"
echo "$CSUM  /tmp/dl.tar.gz" | sha256sum -c -        # OK
```

A mismatch is defect D24/D96 territory — the recorded digest must describe the
bytes. Also confirm `HEAD` works and does **not** increment the download counter
(§3.6).

#### 3.5.5 Deprecate / un-deprecate (`PUT /packages`)

```bash
curl -sS -X PUT "$API/packages" -H "Authorization: Bearer $ACCESS" \
  -F "namespace=$NS" -F "name=$PKG" -F "isDeprecated=true" \
  | jq -e '.code==200 and (.message|test("deprecated"))'

# the flag must be visible on BOTH spellings of the version
curl -sS "$API/packages/$NS/$PKG" | jq -e '
  .data.latest_version_data.is_deprecated==true
  and .data.latest_version_data.isDeprecated=="true"
'
# and the deprecated package must drop out of search
curl -sS "$API/packages?query=$PKG" | jq -e --arg p "$PKG" '[.packages[].name] | index($p) == null'

# un-deprecate (isDeprecated=false) must work too
curl -sS -X PUT "$API/packages" -H "Authorization: Bearer $ACCESS" \
  -F "namespace=$NS" -F "name=$PKG" -F "isDeprecated=false" | jq -e '.code==200'
```

A `PUT` that returns "deprecated successfully" while `isDeprecated` stays `"false"`
is the exact defect this route was added to close (D26 / D-7.3). Assert both.

#### 3.5.6 Role probe

```bash
curl -sS -X POST "$API/packages/$NS/$PKG/verify" -H "Authorization: Bearer $ACCESS" \
  | jq -e '.code==200 and .isVerified==true'
```

`isVerified` (camelCase) is a boolean the frontend stores directly.

#### 3.5.7 Package-scoped upload token

```bash
curl -sS -X POST "$API/packages/$NS/$PKG/uploadToken" -H "Authorization: Bearer $ACCESS" \
  | jq -e '.code==200 and .upload_token and .uploadToken and (.upload_token==.uploadToken)'
```

Both keys are emitted here too (the old backend emitted only `upload_token` while
the UI read `uploadToken`).

### 3.6 Tarball routes and usage

| Method | Path | Expected |
|---|---|---|
| GET/HEAD | `/tarballs/{ns}/{pkg}/{ver}` | 200 gzip + `X-Checksum-SHA256` |
| GET/HEAD | `/download/{ns}/{pkg}/{ver}` | same object (legacy spelling) |
| GET | `/tarballs/{ns}/{pkg}/{ver}/{pkg}-{ver}.tar.gz` | same; wrong artifact name → 404 |
| GET | `/tarballs/usage` | `{code:200,objects,bytes,limit_bytes}` |
| GET | `/static/{archive}` | R2 archive (legacy path; see §3.8) |

```bash
# alias spelling serves the same bytes
diff <(curl -sS "$API/tarballs/$NS/$PKG/$VER") <(curl -sS "$API/download/$NS/$PKG/$VER") \
  && echo "aliases identical"

# wrong artifact segment must 404, not silently serve the real file
curl -sS -o /dev/null -w 'wrong artifact HTTP %{http_code}\n' \
  "$API/tarballs/$NS/$PKG/$VER/garbage.tar.gz"          # 404

# download counter: HEAD must not count, GET must
BEFORE="$(curl -sS "$API/packages/$NS/$PKG" | jq .data.downloads)"
curl -sS -o /dev/null -I "$API/tarballs/$NS/$PKG/$VER"
MID="$(sleep 2; curl -sS "$API/packages/$NS/$PKG" | jq .data.downloads)"
curl -sS -o /dev/null "$API/tarballs/$NS/$PKG/$VER"
AFTER="$(sleep 2; curl -sS "$API/packages/$NS/$PKG" | jq .data.downloads)"
echo "before=$BEFORE afterHEAD=$MID afterGET=$AFTER"
[[ "$BEFORE" == "$MID" && "$AFTER" -gt "$MID" ]] && echo "counter OK"
```

Counting is asynchronous (a `waitUntil` write), hence the short sleeps. It also
increments on a cache **hit**, so repeat the GET if the first was a miss and the
count did not move yet.

### 3.7 Ratings and reports

| Method | Path | Form | Auth | Expected |
|---|---|---|---|---|
| POST | `/ratings/{ns}/{pkg}` | `rating` `"1"`–`"5"` | Bearer | `{code:200,message:"Ratings Submitted Successfully"}` |
| POST | `/report/{ns}/{pkg}` | `reason` (≥10 chars) | Bearer | `{code:200,message:"Malicious Report Submitted Successfully"}` |
| GET | `/report/view` | — | Bearer admin | `{code:200,reports:[…]}` |

```bash
curl -sS -X POST "$API/ratings/$NS/$PKG" -H "Authorization: Bearer $ACCESS" \
  -F "rating=5" | jq -e '.code==200'
# the average is a NUMBER, not a 1-element array (defect D21)
curl -sS "$API/packages/$NS/$PKG" | jq -e '.data.ratings|type=="number"'
curl -sS "$API/packages/$NS/$PKG" | jq '.data.ratings, .data.ratings_count'
```

`ratings` must be a number (e.g. `5`) and `ratings_count` an object with keys
`"1".."5"`.

```bash
# a non-numeric rating is a 400, not a 500 (the legacy int() crashed)
curl -sS -o /dev/null -w 'bad rating HTTP %{http_code}\n' -X POST "$API/ratings/$NS/$PKG" \
  -H "Authorization: Bearer $ACCESS" -F "rating=abc"    # 400

# a too-short reason is a 400
curl -sS -o /dev/null -w 'short reason HTTP %{http_code}\n' -X POST "$API/report/$NS/$PKG" \
  -H "Authorization: Bearer $ACCESS" -F "reason=bad"    # 400

# a valid report marks the package malicious
curl -sS -X POST "$API/report/$NS/$PKG" -H "Authorization: Bearer $ACCESS" \
  -F "reason=This is a QA test report, not a real one." | jq -e '.code==200'
curl -sS "$API/packages/$NS/$PKG" | jq -e '.data.is_malicious==true'

# admin triage queue (needs an admin token). Viewing MARKS reports viewed.
curl -sS "$API/report/view" -H "Authorization: Bearer $ADMIN_ACCESS" \
  | jq -e '.code==200 and (.reports|type=="array")'
```

### 3.8 Archives

| Method | Path | Expected |
|---|---|---|
| GET | `/registry/archives` | `{code:200,message:"Successfully Fetched Archives",archives:[…],entries:[…]}` |
| GET | `/archives/{name}` | 200 gzip; invalid name → 400; missing → 404 |
| GET | `/static/{name}` | same bytes as `/archives/{name}` (legacy link form) |

```bash
curl -sS "$API/registry/archives" | jq -e '.code==200 and (.archives|type=="array")'
```

```bash
# traversal must be rejected before R2 is touched (defect D5)
curl -sS -o /dev/null -w 'traversal HTTP %{http_code}\n' \
  "$API/archives/..%2F..%2Ftarballs%2Fx.tar.gz"        # 400
curl -sS -o /dev/null -w 'missing archive HTTP %{http_code}\n' \
  "$API/archives/does-not-exist.tar.gz"                  # 404
```

If a snapshot exists, confirm the two spellings agree:

```bash
NAME="$(curl -sS "$API/registry/archives" | jq -r '.archives[0] // empty')"
[ -n "$NAME" ] && diff \
  <(curl -sS "$API/archives/$NAME") <(curl -sS "$API/static/$NAME") && echo "archive aliases identical"
```

Snapshots are **package and namespace documents only** — never user documents.
Downloading one and grepping for `"password"` or `"uuid"` must come back empty.

### 3.9 Maintainership (6 routes) + validation callback

These live at `/{username}/…`, a **dynamic first segment**. Confirm they do not
shadow the static prefixes: a request to `/auth/login` must still log in. All six
require `pathUsername` to equal the authenticated user's own username (preserved
quirk — even site admins cannot act as another user here).

| Method | Path | Form | Expected |
|---|---|---|---|
| POST | `/{user}/maintainer` | `username`,`namespace`,`package` | `"Maintainer added successfully"` / `"Maintainer already added"` |
| POST | `/{user}/maintainer/remove` | `username`,`namespace`,`package` | `"Maintainer removed successfully"` / `"Package maintainer not found"` |
| POST | `/{user}/namespace/maintainer` | `username`,`namespace` | `"Maintainer added successfully"` / `"Maintainer already added"` |
| POST | `/{user}/namespace/maintainer/remove` | `username`,`namespace` | `"Maintainer removed successfully"` / `"Namespace maintainer not found"` |
| POST | `/{user}/namespace/admin` | `username`,`namespace` | `"Admin added successfully"` / `"Admin already added"` |
| POST | `/{user}/namespace/admin/remove` | `username`,`namespace` | `"Admin removed successfully"` / `"Admin already removed"` |

```bash
# create a second account to add as maintainer
USER2="qauser2${RUN}"; EMAIL2="${USER2}@example.invalid"
curl -sS -X POST "$API/auth/signup" -F "username=$USER2" -F "email=$EMAIL2" -F "password=$PASS" >/dev/null
# (verify USER2 the same way as §3.0.3 if you need to log in as them)

# add USER2 as a package maintainer, acting as USER
curl -sS -X POST "$API/$USER/maintainer" -H "Authorization: Bearer $ACCESS" \
  -F "username=$USER2" -F "namespace=$NS" -F "package=$PKG" | jq -e '.code==200'

curl -sS "$API/packages/$NS/$PKG/maintainers" | jq -e --arg u "$USER2" '[.users[].username]|index($u)!=null'

# remove again
curl -sS -X POST "$API/$USER/maintainer/remove" -H "Authorization: Bearer $ACCESS" \
  -F "username=$USER2" -F "namespace=$NS" -F "package=$PKG" | jq -e '.code==200'
```

Also assert the shadowing guard explicitly:

```bash
curl -sS -X POST "$API/auth/login" -F "user_identifier=$USER" -F "password=$PASS" \
  | jq -e '.code==200'      # static prefix still wins over /{username}/...
```

#### 3.9.1–3.9.2 Validation callback (internal)

Authenticated by `VALIDATION_SECRET`, **not** a user JWT. Fail-closed when unset.

| Method | Path | Auth | Expected |
|---|---|---|---|
| GET | `/internal/validation/pending?limit=N` | `Bearer $VALIDATION_SECRET` | `{code:200,jobs:[…],count,hint}` |
| POST | `/internal/validation/result` | `Bearer $VALIDATION_SECRET` | `{code:200,applied,failed}` |
| either | either | none | `401` |
| either | either | unset secret | `503` |

```bash
curl -sS "$API/internal/validation/pending?limit=2" \
  -H "Authorization: Bearer $VALIDATION_SECRET" | jq '.code, .count, .hint'
```

The freshly uploaded package should appear here (`unable_to_verify: true`), with a
`tarball_url` pointing at `${HOST}/tarballs/{ns}/{pkg}/{version}`.

```bash
# Apply a success verdict for the version we uploaded. NOTE: this mutates
# package metadata; only do it for the QA package.
cat > /tmp/verdict.json <<JSON
{ "namespace": "$NS", "package": "$PKG", "version": "$VER", "ok": true,
  "description": "QA package", "license": "MIT" }
JSON
curl -sS -X POST "$API/internal/validation/result" \
  -H "Authorization: Bearer $VALIDATION_SECRET" \
  -H 'Content-Type: application/json' --data @/tmp/verdict.json \
  | jq -e '.code==200 and .applied==1'
curl -sS "$API/packages/$NS/$PKG" | jq -e '.data.is_verified==true and .data.unable_to_verify==false'
```

Negative checks:

```bash
curl -sS -o /dev/null -w 'no secret HTTP %{http_code}\n' "$API/internal/validation/pending"   # 401
curl -sS -o /dev/null -w 'bad secret HTTP %{http_code}\n' -H 'Authorization: Bearer nope' \
  "$API/internal/validation/pending"                                                          # 401
```

### 3.10 User delete cascade (site admin only)

Destructive; use a throwaway account. Proves defect D13/D78 are closed.

```bash
# as ADMIN, delete a user and confirm their packages/namespaces are gone
curl -sS -X POST "$API/users/delete" -H "Authorization: Bearer $ADMIN_ACCESS" \
  -F "username=$THROWAWAY" | jq -e '.code==200 and .message=="User deleted"'
curl -sS -o /dev/null -w 'deleted user HTTP %{http_code}\n' "$API/users/$THROWAWAY"   # 404
```

### 3.11 Cleanup

```bash
# As a site admin: delete the namespace (cascades packages + R2 objects).
curl -sS -X POST "$API/namespace/$NS/delete" -H "Authorization: Bearer $ADMIN_ACCESS" \
  | jq -e '.code==200 and .message=="Namespace deleted successfully"'

# Confirm the tarball is gone from R2 (delete is scheduled via waitUntil; retry a
# few times before declaring failure).
for i in 1 2 3 4 5; do
  S="$(curl -sS -o /dev/null -w '%{http_code}' "$API/tarballs/$NS/$PKG/$VER")"
  echo "attempt $i: HTTP $S"; [ "$S" = 404 ] && break; sleep 3
done
```

---

## 4. fpm end-to-end

This is the check the request centres on: **a real `fpm` client can publish and
consume a package**. The API-level checks in §3 prove each route in isolation;
this proves the wire protocol the CLI actually speaks.

### 4.1 Point fpm at the registry

Two different things are configured in two different ways, and conflating them is
the usual cause of a confusing failure:

| Action | Registry used | How to point it |
|---|---|---|
| **Dependency download** (`fpm build` fetches a registry dep) | the `[registry] url` in `~/.local/share/fpm/config.toml` | edit the config file (below) |
| **Publish** (`fpm publish`) | the registry the `fpm` binary is built against (the official registry) | not selectable via config in all releases |

So the config file below makes `fpm build` **download** from `$API`; `fpm publish`
goes to whatever registry the CLI targets. To publish to a **staging** registry,
use the raw-`curl` mirror in §4.3 — `fpm` cannot always be repointed for publish.

```bash
mkdir -p ~/.local/share/fpm
cat > ~/.local/share/fpm/config.toml <<EOF
[registry]
url = "$API"
EOF
cat ~/.local/share/fpm/config.toml
```

`fpm --version` must be **0.8.2 or newer** (registry support landed there). Check
the flags your build actually has with `fpm publish --help` — a `--registry` flag
is **not** present in every release, and inventing it produces a usage error that
looks like a registry fault.

### 4.2 Publish a real package

`fpm publish` has three hard prerequisites that trip people up. Build them into
the fixture:

1. **The package must be a git repository with a committed `HEAD`.** `fpm publish`
   runs `git archive HEAD` to build the tarball, so an uncommitted directory
   fails with an archive error, not a registry error.
2. **`[build] module-naming = true`** (or a custom module prefix). Without it fpm
   stops with *"The package does not meet the module naming requirements."*
3. **A valid SPDX `license` and a non-`0` semver `version`**, and no `git`
   dependencies.

```bash
# A minimal but real, COMMITTED fpm project.
export FPMDIR="/tmp/fpmqa-${RUN}"
export FPMPKG="qa-fpm-${RUN}"
rm -rf "$FPMDIR" && mkdir -p "$FPMDIR/src"
cat > "$FPMDIR/fpm.toml" <<EOF
name = "$FPMPKG"
version = "1.0.0"
license = "MIT"
author = "QA"
maintainer = "qa@example.invalid"
copyright = "2026 QA"

[build]
module-naming = true
EOF
cat > "$FPMDIR/src/main.f90" <<'EOF'
module qa_main
  implicit none
contains
  subroutine hello()
    print *, "hello from qa"
  end subroutine hello
end module qa_main
EOF
git -C "$FPMDIR" init -q
git -C "$FPMDIR" add -A
git -C "$FPMDIR" -c user.email=qa@example.invalid -c user.name=QA commit -qm "qa package"
```

Publish (token from §3.4; `--token` is a form field, not a header). `fpm publish`
builds the artifact from the project, so run it from inside `$FPMDIR`:

```bash
cd "$FPMDIR"
fpm publish --token "$UPTOKEN" --verbose
```

Expected: a success message; the package appears at
`GET /packages/$NS/$FPMPKG`. If it fails, `--verbose` prints the multipart fields
and the registry's response.

`fpm publish` flags worth exercising (from the fpm docs):

```bash
# What version would be published? No network.
fpm publish --show-package-version

# Exactly what WOULD be sent, including the token and a built tarball. No network.
fpm publish --token "$UPTOKEN" --show-upload-data

# Simulate the upload: builds the tarball, verifies package AND token against the
# registry, then prints the local tarball path. Publishes nothing.
fpm publish --token "$UPTOKEN" --dry-run --verbose
```

> **`--dry-run` caveat.** It does contact the registry to verify the token in
> current releases, but the exact behaviour has varied. The API-level dry run in
> §3.5.3a is the authoritative "no side effects" check; treat `fpm publish
> --dry-run` as corroborating evidence, not the gate.

### 4.3 Byte-equivalent raw mirror of `fpm publish`

If `fpm` is unavailable, or a publish fails and you need to isolate CLI vs API,
this is exactly what the CLI sends. It builds a tarball the same way `fpm` does
(`git archive` of the committed tree) and posts the identical fields:

```bash
# Mirror fpm's own tarball: `git archive HEAD` of the committed project.
git -C "$FPMDIR" archive --format=tar.gz -o "/tmp/${FPMPKG}.tar.gz" HEAD

curl -sS -X POST "$API/packages" \
  -F "package_name=$FPMPKG" \
  -F "package_license=MIT" \
  -F "package_version=1.0.0" \
  -F "upload_token=$UPTOKEN" \
  -F "tarball=@/tmp/${FPMPKG}.tar.gz" \
  | jq
```

Fields, exactly: `package_name`, `package_license`, `package_version`, `tarball`,
`upload_token`. The namespace is derived from the token, **not** from a form
field. A `curl` that succeeds where `fpm` fails means a CLI-side issue; the
reverse means the CLI is sending something this table does not.

To isolate the API from the CLI entirely, mirror the **dry run** too — identical
fields plus `dry_run=true`, and nothing is persisted:

```bash
curl -sS -X POST "$API/packages" \
  -F "package_name=$FPMPKG" -F "package_license=MIT" -F "package_version=1.0.0" \
  -F "upload_token=$UPTOKEN" -F "dry_run=true" \
  -F "tarball=@/tmp/${FPMPKG}.tar.gz" | jq -e '.message=="Dry run Successful."'
```

### 4.4 Consume via dependency resolution (`fpm build`)

`fpm` resolves a registry dependency with **two** calls:

1. `GET {registry}/packages/{namespace}/{package}` (or `/{version}` when pinned)
   and require `code:200` with `data.latest_version_data` containing `version` and
   a **root-relative** `download_url` (`/…`).
2. `GET {registry}{download_url}` and unpack the tarball.

Verify call 1 with `jq`, then let `fpm` do call 2:

```bash
# 4.4.1 the exact metadata fpm needs
curl -sS "$API/packages/$NS/$FPMPKG" | jq -e '
  .code==200
  and (.data.latest_version_data.version|type=="string")
  and (.data.latest_version_data.download_url|startswith("/"))
'
# 4.4.2 and that the URL resolves
DL="$(curl -sS "$API/packages/$NS/$FPMPKG" | jq -r .data.latest_version_data.download_url)"
curl -sS -o /dev/null -w "download_url HTTP %{http_code}  %{size_download} bytes\n" "$API$DL"
```

```bash
# 4.4.3 a consumer project that depends on it.
#         Registry deps declare a NAMESPACE via a dotted key, not a "ns/pkg" string.
export CONSUMER="/tmp/fpmconsumer-${RUN}"
rm -rf "$CONSUMER" && mkdir -p "$CONSUMER/src"
cat > "$CONSUMER/fpm.toml" <<EOF
name = "qa-consumer-${RUN}"
version = "0.1.0"

[dependencies]
${FPMPKG}.namespace = "$NS"
EOF
cat > "$CONSUMER/src/main.f90" <<'EOF'
program main
  print *, "consumer built"
end program main
EOF
cd "$CONSUMER" && fpm build --verbose
```

A successful `fpm build` proves the two-step protocol; a failure here with §4.4.1
and §4.4.2 green points at the dependency key syntax or the CLI's registry lookup,
not the API. To pin a version, add a `.v` key:

```toml
[dependencies]
qa-fpm-XXXX.namespace = "qansXXXX"
qa-fpm-XXXX.v = "1.0.0"
```

If you pin a version, the CLI calls `/packages/{ns}/{pkg}/{version}` and reads
`data.version_data` instead of `data.latest_version_data`:

```bash
curl -sS "$API/packages/$NS/$FPMPKG/1.0.0" \
  | jq -e '.code==200 and .data.version_data.version=="1.0.0"'
```

> **Root-relative is load-bearing.** `fpm` concatenates `download_url` onto the
> registry base. A URL emitted as absolute (`https://…/tarballs/…`) or missing the
> leading `/` will make `fpm` fetch the wrong host or 404. Assert
> `startswith("/")` every time.

---

## 5. Frontend UI checklist

The API can be perfect while the UI is broken (missing env at build time, a
Redux slice not reset on logout, a label with no `for`). Click through these on the
deployed frontend (`REACT_APP_REGISTRY_API_URL` must point at `$API`).

| # | Page | Action | Must see |
|---|---|---|---|
| 5.1 | `/` Home | load | search lists packages; no console errors |
| 5.2 | Search | type a query, wait for debounce | results update; pagination works |
| 5.3 | Search | sort by "Date last updated" and "Downloads" | order actually changes (not name-sorted) |
| 5.4 | Package `/packages/{ns}/{pkg}` | open | versions list, deprecation badge reflects `isDeprecated`, ratings show a number |
| 5.5 | Package | click Download | tarball downloads; filename `pkg-ver.tar.gz` |
| 5.6 | Package | rate it (logged in) | success toast; graph/average updates |
| 5.7 | Package | report it | success toast; appears in admin triage |
| 5.8 | Register `/register` | create account | "verify your email" message |
| 5.9 | Login `/login` | bad password | "Invalid email or password" — indistinguishable from unknown user |
| 5.10 | Login | correct | redirected; navbar shows username |
| 5.11 | Dashboard | open | user's packages and namespaces render (not empty, no `undefined` keys) |
| 5.12 | Dashboard | generate package token | the token is **non-empty** and copyable (this was broken: D-7.4) |
| 5.13 | Dashboard | generate namespace token | token shown |
| 5.14 | Namespace `/namespace/{ns}` | open | description (if set) and package list render; `createdAt` renders, not `{}` |
| 5.15 | Create namespace | submit | success; appears in dashboard |
| 5.16 | Admin page | as admin | add/remove maintainers and admins all succeed (these 401'd on the legacy stack) |
| 5.17 | Admin page | view malicious reports | reports listed; reloading does not show the same ones again (viewed-marking) |
| 5.18 | Archives | open | snapshot list renders; download works |
| 5.19 | Account | change email | "verify your new email" |
| 5.20 | Logout → login as a **different** user | — | no data from the previous account leaks (defect D97) |
| 5.21 | Any page | open with the network tab | every request carries `Authorization: Bearer` where the route needs it |
| 5.22 | 404 | visit a bad route | the app's 404 page, not a blank screen |

Two invariants worth knowing when a page "looks fine but is empty":

- **`createdAt` must be a string.** If it renders as `{}` or crashes, the API is
  emitting a BSON `Date` and `toJsonSafe` is not being applied on that route.
- **`ver.isDeprecated` is the *string* `"true"`.** The badge compares against a
  string; a boolean `true` renders every version as "Active".

---

## 6. Negative and security tests

Each row asserts a defence that was either broken or absent and must not regress.

| # | Attack / misuse | Command sketch | Expected |
|---|---|---|---|
| 6.1 | Login with a bare account uuid as verification | `POST /auth/verify-email -F uuid=<users.uuid>` | `401` (D2) |
| 6.2 | Forgot-password for an unknown address | `POST /auth/forgot-password -F email=nobody@…` | `200`, generic message |
| 6.3 | Upload with a garbage token | `POST /packages -F upload_token=nope …` | `401 "Invalid upload token"` |
| 6.4 | Upload with **no** token | `POST /packages` without `upload_token` | `400 "Upload token missing"` |
| 6.5 | Upload with a revoked token | revoke, then publish | `401` |
| 6.6 | Upload an oversized tarball | > `MAX_TARBALL_BYTES` (50 MB) | `413` |
| 6.7 | Upload a path-traversal package name | `package_name=../../etc/passwd` | `400` (charset) |
| 6.8 | Upload an invalid SPDX license | `package_license=NotALicense` | `400` |
| 6.9 | Non-admin calls an admin route | `POST /users/admin` as a normal user | `401` with `reason:"forbidden"` |
| 6.10 | Non-admin deletes a package/namespace | `POST /packages/{ns}/{pkg}/delete` as user | `401`/forbidden |
| 6.11 | Namespace delete without cascade | create ns with a package, delete ns, re-GET package | `404` (D11/D12) |
| 6.12 | Archive path traversal | `GET /archives/..%2F..%2Ftarballs%2Fx.tar.gz` | `400` (D5) |
| 6.13 | Archive listing must not leak user data | download newest snapshot, grep for `password`/`uuid` | no matches |
| 6.14 | Unknown Origin | `curl -H 'Origin: https://evil.example'` | no `Access-Control-Allow-Origin` |
| 6.15 | Validation secret absent | `GET /internal/validation/pending` with no header | `401`; with wrong secret, `401` |
| 6.16 | Rate-limit refusal | exceed auth limit (§7) | `429` + `Retry-After`, body `code:429` |
| 6.17 | Malformed JSON to validation result | `--data 'not json'` | `400 "Expected a JSON body"` |
| 6.18 | Oversized validation batch | > 50 results | `400 "At most 50 results per request"` |
| 6.19 | Upload token revoke by a non-owner | second user revokes first user's token | `404` (no leak of existence) |
| 6.20 | Duplicate namespace name | `POST /namespaces` twice | second is `400 "Namespace already exists"` |

```bash
# 6.1 the D2 regression guard — a bare uuid must NOT verify anything
UUID="$(mongosh "$MONGO_URI" --quiet --eval "db.getSiblingDB('$MONGO_DB_NAME').users.findOne({username:'$USER'}).uuid")"
curl -sS -o /dev/null -w 'bare-uuid verify HTTP %{http_code}\n' \
  -X POST "$API/auth/verify-email" -F "uuid=$UUID"          # 401

# 6.3 garbage token
curl -sS -o /dev/null -w 'garbage token HTTP %{http_code}\n' -X POST "$API/packages" \
  -F "upload_token=definitely-not-a-token" -F "package_name=x" -F "package_version=1.0.0" \
  -F "package_license=MIT" -F "tarball=@/tmp/${PKG}.tar.gz"          # 401
```

---

## 7. Rate limits and free-tier observability

The design targets **$0/month on free tiers**, so several "outages" are quota
exhaustion rather than bugs. Watch for these before they bite.

### 7.1 Exercising the limiter

```bash
# Auth bucket: 10/min. The 11th call in a window must be 429.
for i in $(seq 1 12); do
  curl -sS -o /dev/null -w "auth $i: %{http_code}\n" -X POST "$API/auth/login" \
    -F "user_identifier=$USER" -F "password=wrong-$i"
done
```

Expected: the first ~10 are `401`, then `429`. A `429` body is
`{code:429,message:"Rate limit exceeded…",path}` with a `Retry-After` header.

```bash
# General bucket advertises its budget on every response
curl -si "$API/packages?query=fortran" | grep -i 'x-ratelimit-limit'   # 100
```

Exempt (never limited): `/health`, `/healthz`, `/`, `/apidocs`,
`/apidocs/openapi.json`. Confirm a flood of `/health` never returns `429`:

```bash
for i in $(seq 1 30); do curl -sS -o /dev/null -w '%{http_code} ' "$API/health"; done; echo
```

Counting is **per account** (Bearer `sub`) for authenticated calls and **per
source address** (`cf-connecting-ip`) for anonymous ones. If the counter store is
unreachable the limiter **fails open** (no headers, requests proceed) — that is
deliberate, so monitor for *missing* `X-RateLimit-*` headers rather than assuming a
limit is in force.

### 7.2 Free-tier signals to watch after deploy

| Signal | Where | Meaning / action |
|---|---|---|
| Error **1102** | Workers → invocation outcomes | Exceeded 10 ms CPU. Something heavy moved into a handler (KDF/Mongo must stay in the DO). |
| Error **1027** | invocation outcomes | Over 100,000 req/day. Free tier exhausted. |
| `mongo.connected == false` | `/health` | MongoDB unreachable. Page someone. |
| R2 usage > 8 GB | `GET /tarballs/usage` | Approaching the 10 GB ceiling. |
| `x-ratelimit-*` absent | any response | Limiter failed open — counter store unreachable. |
| Validation queue depth | `GET /internal/validation/pending` `count` | Backlog means the 30-min GitHub cron is not draining. |

```bash
# Snapshot all cheap signals at once
echo "health:  $(curl -sS "$API/health" | jq -c '{status, mongo}')"
echo "storage: $(curl -sS "$API/tarballs/usage" | jq -c '{objects, bytes, limit_bytes}')"
echo "pending: $(curl -sS "$API/internal/validation/pending?limit=1" \
  -H "Authorization: Bearer $VALIDATION_SECRET" | jq -r .count)"
```

### 7.3 Cron health (3 triggers)

The Worker runs three crons (`worker/wrangler.jsonc`). You cannot trigger them by
hand from the outside, but you can verify their *effects*:

| Cron | Effect to verify |
|---|---|
| `17 * * * *` | search works even on a fresh DB (bootstrap ran / self-heal fired) |
| `0 3 * * *` | expired `upload_tokens`/`auth_tokens` are gone after the sweep |
| `0 4 * * 0` | a fresh snapshot exists in `/registry/archives`; orphaned tarballs gone |

### 7.4 The "text index required" failure

If §2.2 or any search 500s with `text index required`, the lazy self-heal
(`ensureIndexesOnce`) did not fire. It attempts once per isolate. Confirm the
hourly bootstrap has run by watching Workers Logs for `cron bootstrap`, or wait for
`17 * * * *`. A persistent failure means `MONGO_POOL` is bound but the bootstrap
op is failing — check `MONGO_URI` and the DB user's privileges.

---

## 8. Rollback drill

Rehearse this **before** you need it. The Worker is stateless; all durable state
lives in MongoDB and R2, neither of which a rollback touches.

```bash
# What is live?
npx wrangler versions list

# Send 100% of traffic to the previous version (immutable; no rebuild).
npx wrangler rollback
```

Expected: traffic shifts within ~60 s. Re-run §2 (smoke) immediately after.

If the Worker is not serving at all: repoint the hostname at a previous version or
remove the route in the Cloudflare dashboard — seconds, and it touches no data.

### 8.1 What a rollback does **not** fix

> **MongoDB writes are not transactional with respect to a Worker rollback.** A
> package published while version *N* is live stays published after rolling back to
> *N-1*. This is inherent to code rollback against a shared datastore. It is why
> §3 uses a throwaway namespace rather than the production one.

Document how you exercised the drill:

- Date of drill: `________`
- From version → to version: `________`
- Time to shift traffic: `________`
- §2 re-run result: `PASS / FAIL`
- Notes: `________`

---

## 9. Sign-off

Sign off only when **every** row is `PASS`. A single `FAIL` blocks the cutover.

| § | Area | Environment | Result | Tester | Date |
|---|---|---|---|---|---|
| 1 | Pre-deploy gate | | | | |
| 2 | Post-deploy smoke | | | | |
| 3.1 | Meta | | | | |
| 3.2 | Auth | | | | |
| 3.3 | Users | | | | |
| 3.4 | Namespaces | | | | |
| 3.5 | Packages | | | | |
| 3.6 | Tarballs + usage | | | | |
| 3.7 | Ratings + reports | | | | |
| 3.8 | Archives | | | | |
| 3.9 | Maintainership + validation | | | | |
| 3.10 | User-delete cascade | | | | |
| 3.11 | Cleanup | | | | |
| 4 | fpm end-to-end | | | | |
| 5 | Frontend UI | | | | |
| 6 | Negative / security | | | | |
| 7 | Rate limits / observability | | | | |
| 8 | Rollback drill | | | | |

**Overall:** `PASS / FAIL`  **Cutover approved by:** `________`  **Time:** `________`

---

## Appendix A — Automated harnesses (run these too)

The manual checklist is the floor, not the ceiling. These exercise paths that are
tedious or error-prone by hand:

| Script | What it proves | Needs |
|---|---|---|
| `scripts/smoke.sh` | §2 post-deploy smoke as one read-only command (HTTP 2xx **and** body `code:200`) | API |
| `scripts/write_path_audit.mjs` | 69 assertions over signup, auth, publish, R2, ratings, deprecation, three cascade deletes | API + Mongo |
| `scripts/write_path_fuzz.mjs` | malformed/oversized/adversarial inputs | API + Mongo |
| `scripts/auth_journey.cjs` | full auth flow | API + Mongo |
| `scripts/member_journey.cjs` | maintainer/admin role changes | API + Mongo |
| `scripts/token_journey.cjs` | upload-token lifecycle incl. revoke | API + Mongo |
| `scripts/write_journey.cjs` | publish → consume | API + Mongo |
| `scripts/rate_limit_probe.cjs` | limits are actually enforced | API + Mongo |
| `scripts/check_api_compat.py` | endpoint/response-shape compatibility | API |
| `scripts/validate_packages.py` | the validator worker itself (against `/internal/validation`) | API + secret |
| `scripts/check_deploy_ready.mjs` | `wrangler.jsonc` completeness | node |
| `scripts/check_no_secrets.mjs` | no credential in tracked source | node |
| `scripts/check_no_shell_injection.mjs` | no `shell=True` in Python | node |

Prefer the harnesses for §3 (they assert database state too), but keep the manual
run for a release: it is the only check a human can read end to end while the
pager is quiet.

## Appendix B — Common failure signatures

| Symptom | Most likely cause | Where to look |
|---|---|---|
| `500` on everything, no other clue | `MONGO_URI` or `SALT` missing/unset | `wrangler secret list`; `DEPLOYMENT.md` §1 |
| `1102` on every login/signup | KDF or Mongo connection ran in the Worker, not the DO | handler imports; `mongo-pool.ts` |
| Search 500s `text index required` | bootstrap not run / self-heal exhausted | §7.4 |
| Uploads `401` with a token you just minted | token expired (7-day default), revoked, exhausted, or scoped to another package | inspect `upload_tokens`; mint a fresh one |
| Uploads `400 "Version already exists"` | that version is already published | use a new version |
| `2xx` but body has no `code` | envelope helper bypassed | the route returning the response |
| `x-cache` never `HIT` | KV binding missing in that `env` block | `worker/wrangler.jsonc` |
| Deprecation "succeeds" but badge still shows Active | only the package flag was set, not the version flags | `PUT /packages` handler (§3.5.5) |
| `createdAt` renders `{}` | BSON `Date` not passed through `toJsonSafe` | the route's response builder |
| Validation never runs | `VALIDATION_SECRET` mismatch or `REGISTRY_API_URL` unset | `validate-packages.yml`; `DEPLOYMENT.md` §1 |
| Every non-admin is logged out right after login | a permission refusal returned a bare `401` without `reason:"forbidden"` | `lib/responses.ts` |

## Appendix C — Related documents

- [`../DEPLOYMENT.md`](../DEPLOYMENT.md) — deploy, rollback, monitoring, free-tier budget
- [`API_CONTRACT.md`](API_CONTRACT.md) — the frozen, machine-checked API surface
- [`api-reference.md`](api-reference.md) — endpoint reference
- [`authentication.md`](authentication.md) — auth flows, JWT, RBAC
- [`BASELINE_AUDIT.md`](BASELINE_AUDIT.md) — the defect register this runbook guards against
