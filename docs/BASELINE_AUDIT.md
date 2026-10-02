# Baseline Audit — branch selection & defect register

> **Date:** 2026-10-02 · **Decision:** migrate from **`origin/v2.0.1`** (`0e3677d`, 2026-02-11),
> not `main`. · **Method:** full-tree and full-history `git` comparison of all 4 branches, plus a
> line-by-line read of every backend module.

---

## 1. Why `v2.0.1` is the base

| Criterion | `main` | `base` | `henils-main` | **`v2.0.1`** | Winner |
|---|---|---|---|---|---|
| Last commit | 2025-06-13 | 2025-06-14 | 2024-02-04 | **2026-02-11** | v2.0.1 |
| Commits ahead of `main` | 0 | 8 | 3 | **125** | v2.0.1 |
| Strict content superset of `main`? | — | ✗ (2 behind) | ✗ (128 behind) | **✓** | v2.0.1 |
| Backend maturity | `app.py` 583 B | 583 B | 583 B | **`app.py` 7460 B + `mongo.py` 7445 B + `utils/` pkg + `latency.py`** | v2.0.1 |
| Hardcoded JWT secret | ✗ | ✗ | ✗ | **✓ removed** | v2.0.1 |
| Password hashing | `sha256(pw+SALT)` | same | same | **bcrypt + legacy migration** | v2.0.1 |
| Email transport | SMTP :587 at import | SMTP | SMTP | **Brevo HTTPS** | v2.0.1 |
| Mongo indexes | none | none | none | **`ensure_indexes()`** | v2.0.1 |
| Tests | 33 | 33 | 33 | **38 + real harness** | v2.0.1 |
| N+1 queries | yes | yes | yes | **batched with `$in`** | v2.0.1 |
| Docs | 1 stale file | same | same | **8 files, 69 KB** | v2.0.1 |
| CI | unittest | unittest | docker-compose (fragile) | **pytest + coverage, all branches** | v2.0.1 |
| Frontend | 83 files, `mdbreact` | 84 | 73 (regressions) | **93, `mdbreact` removed** | v2.0.1 |
| Serverless / edge infra | none | none | none | **none** | tie — greenfield |

**`v2.0.1` independently solved two problems this migration plan had already identified:**

1. `backend/mail.py` — *"Email service using Brevo API (**HTTP-based, bypasses SMTP port blocks**)"*.
   Exactly the resolution the plan called for, arrived at separately 8 months earlier.
2. `backend/auth.py` — `verify_password` *"Supports both bcrypt and legacy SHA256 hashes for
   migration"* + `migrate_password_if_needed`. Exactly the dual-verify + lazy-rehash strategy.

Adopting `v2.0.1` means those two decisions are already battle-tested in this codebase rather than
being re-litigated.

### Branches abandoned

- **`origin/henils-main`** — 128 commits behind, 3 trivial commits, **loses the entire
  rating / malicious-report frontend feature set**. Nothing to port.
- **`origin/base`** — `v2.0.1`'s direct parent; **contributes zero unique files**.
- **`main`** — the only file it has that `v2.0.1` lacks is `backend/check_digests.py`, whose `hash()`
  and `check_digests()` were already inlined verbatim into `v2.0.1`'s `backend/validate.py`.

### Nothing to cherry-pick for serverless

An exhaustive keyword scan across **all 4 branch trees and file contents** found **zero** hits for
`cloudflare`, `wrangler`, `serverless`, `deno`, `d1`, `kv`, `r2`, `worker`. There is no
`wrangler.toml`, no Worker entry point, no binding config, and no automated deploy workflow on any
branch. `v2.0.1:DEPLOYMENT.md` documents deployment as *"SSH to the server and run `docker compose
…`"* and notes automation as future work. **The serverless layer is 100% greenfield.**

---

## 2. Defect register — carried into the rewrite

Severity: 🔴 breaks correctness/security · 🟠 significant · 🟡 cleanup.

### 2.1 🔴 Must fix — security

| ID | Defect | Evidence |
|---|---|---|
| D1 | **Admin backdoor on the public signup route.** Signing up with `password == SUDO_PASSWORD` mints `roles: ["admin"]`. No auth required. | `auth.py:145-149` |
| D2 | **`/auth/verify-email` mints a full access+refresh token pair with no authentication**, flipping `isVerified` from a `uuid` in the request body. | `auth.py:306-331` |
| D3 | **Wildcard CORS.** `CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)` — with an in-code TODO acknowledging it. | `app.py` |
| D4 | **`POST /packages` has no JWT auth.** The 7-day namespace upload token *is* the credential, and **tokens can never be revoked** — `$addToSet` grows the array unbounded with no revoke endpoint. A leaked token is a permanent 7-day publish key. | `packages.py:280-313`, `namespaces.py:97-106` |
| D5 | **Unauthenticated enumeration.** `GET /users/<username>` returns the user's **email address** plus every namespace and package they touch. `GET /registry/archives` lists the full set of `mongodump` database dumps. | `user.py:20-147`, `mongo.py:44-50` |
| D6 | **De-activation bomb in `/auth/verify-email`.** There is no `IS_CI` guard on that route at all. | `auth.py:306-331` |
| D7 | **`0.0.0` version ban + no package-name validation.** `package_name` flows into a filesystem path, a GridFS `metadata.url`, and `subprocess.run(..., shell=True)` in the nightly validator → **shell injection and path traversal**. Only `namespace` names are regex-validated. | `packages.py:243,358,366`; `validate.py:67,69,72,165` |
| D8 | **Decompression-bomb DoS.** `tarfile.open(file_path).getnames()` fully decompresses an attacker-controlled gzip in-request with no size cap; `f"Invalid tarball file. {e}"` echoes internals back to the client. | `packages.py:373-376` |

> D1, D4, D7 are **structurally impossible** in the target architecture and are removed rather than
> ported: upload tokens become short-lived, single-use, hashed-at-rest values minted only for a
> scoped namespace+action; `SUDO_PASSWORD` admin elevation is replaced with explicit role
> assignment; validation moves to GitHub Actions where shell commands run on an ephemeral runner
> with a validated package-name charset.

### 2.2 🔴 Must fix — correctness

| ID | Defect | Evidence |
|---|---|---|
| D9 | **`versions[]` is string-sorted**, so `"0.10.0" < "0.9.0"` and `versions[-1]` — reported to clients as `latest_version_data` — **is the wrong version**. The correct comparator already exists at `packages.py:932` (`sort_versions`) and is **never called**. | `packages.py:470-472, 612, 932` |
| D10 | **`/packages/<ns>/<pkg>/verify` is permanently broken** — queries `{"namespace": namespace_name}` but `namespace` holds an **ObjectId**. Always 404. | `packages.py:657-665` |
| D11 | **`/namespace/<ns>/delete` is permanently broken** — `delete_one({"namespace": namespace_obj.id})` compares a name against an ObjectId. Always returns `code: 500` at **HTTP 200**. | `namespaces.py:147-152` |
| D12 | **Deletes never cascade.** GridFS blobs, `namespaces.packages[]`, `users.authorOf`, `users.maintainerOf` are all left dangling — and a namespace referencing a deleted package **crashes `GET /users/<username>`** with `TypeError: 'NoneType' object is not subscriptable`. | `packages.py:770,816`; `user.py:66-71` |
| D13 | **`/report/view` is read-only** — `malicious_report.isViewed` is never set to `True`, so admins see the same unreviewed reports forever and triage state is a no-op. | `packages.py:1078-1101` |
| D14 | **Nine error paths return HTTP 200 with a non-200 `code`**, including a `401` "namespace owner cannot be removed". Any client trusting HTTP status — and the CDN cache layer — gets it wrong. | `user.py:705`, `auth.py:181`, `packages.py:441,768,907,916`, `namespaces.py:108,143,152` |
| D15 | **`dry_run` leaks a GridFS file and a disk tarball on every call** — the GridFS `put` and disk write happen *before* the `dry_run` early-return, with no cleanup. | `packages.py:359-376, 437` |
| D16 | **9 routes return HTTP 200 with a `code: 404` body**, so the frontend's `code`-based success check cannot distinguish success from failure. | same as D14 |

### 2.3 🟠 Significant

| ID | Defect | Evidence |
|---|---|---|
| D17 | ⚠️ **PARTIALLY CLOSED on `v2.0.1`.** `mongo.py::ensure_indexes()` creates unique indexes on `users.uuid`/`username`/`email`, a unique composite on `packages(name, namespace)`, sort indexes, and a **weighted text index** over `name`, `description`, `registry_description`, `keywords`, `categories`. This item originally read "zero indexes", which is true of `main` and **false of the migrated base**. Remaining gap: the *upload* path still enforces package/version uniqueness with an application-level `find_one`, so a TOCTOU race can still produce duplicates despite the unique index. | `mongo.py:68-116`; `packages.py:294,444` |
| D18 | **Search ignores the text index and uses unescaped `$regex`** over `registry_description` (the entire README.md). No query-length cap → **ReDoS** plus full-scan latency on the hottest public endpoint. The weighted `$text` index that `ensure_indexes()` creates is never actually queried. | `packages.py:92-104, 184-211` |
| D19 | **Client-controllable unbounded page size** — `packages_per_page = total_documents if > total_documents`, so `limit` can be raised to the whole collection and fully materialised in-request. | `packages.py:204` |
| D20 | **Unbounded dynamic-key growth inside a GridFS document** — `downloads_stats.dates.{YYYY-MM-DD}` is `$inc`'d on every download. The 16 MB BSON document limit becomes a hard ceiling. | `packages.py:526-534` |
| D21 | **`ratings` returns a 1-element array, not a number** — `round(sum/len, 3)` produces a tuple, which Flask serialises as `[3.0]`. | `packages.py:576-577` |
| D22 | **Ratings read-modify-write race** — counts are recomputed from a full re-read then `$set`, so concurrent votes lose counts. | `packages.py:999-1030` |
| D23 | **Mutable default arguments** (`versions=[]`, `malicious_report={}`, `ratings={…}`, `roles=[]`, …) shared across all instances — a class-level state leak. | `models/package.py:3-4`, `models/namespace.py:4`, `models/user.py:6` |
| D24 | **No artifact integrity.** No checksum of the tarball is ever computed or stored; `oid` is just a Mongo `_id`. | `packages.py:359-361` |
| D25 | **N+1 read loops** — per-namespace `find_one` in Python; per-user `find_one` for admin/maintainer listings. | `user.py:66`, `namespaces.py:214,237`, `packages.py:922` |
| D26 | **No deprecation API exists**, yet `is_deprecated: False` is a hard filter on both searches — so anything deprecated can never be un-deprecated through any public endpoint. | `packages.py:102, 198, 396, 462` |
| D27 | **Blocking Mongo error-log handler on the root logger**, synchronous and unbuffered — every `ERROR` from any library becomes an `insert_one`, and it can mask the failure it is trying to record. | `mongo.py:24-42` |
| D28 | **`MONGO_USER_NAME` / `MONGO_PASSWORD` are read and silently discarded** — `MongoClient(mongo_uri)` is built without credentials. Setting only those vars yields an unauthenticated connection with no warning. | `mongo.py:14-16` |

### 2.4 🟡 Cleanup

| ID | Item |
|---|---|
| D29 | Dead dependencies: `docker`, `bcrypt`, `markdown` declared but never imported; `numpy` used only for a per-character FNV-1a hash that is *slower* than plain Python ints. |
| D30 | `shutil`, `toml`, `json_util`, `swagger`, `IS_VERCEL` imported but unused in `packages.py`; `sort_versions`, `check_version` are dead functions. |
| D31 | **Dangling OpenAPI reference** — `swag_from("documentation/search_packages_cli.yaml")` points at a file that does not exist, so **`/apidocs` returns 500** and `/packages_cli` is undocumented. |
| D32 | The 35 Swagger YAMLs are **not** standalone documents — each is a path-operation fragment merged into the Swagger 2.0 template. None covers `/`, `/health`, `/latency`, `/registry/archives`. Many declare a required `uuid` form field the code never reads, and response fields the code never returns (`login.yaml` documents `uuid` instead of `access_token`/`refresh_token`; `get_namespace_admins.yaml` documents `admins` but the code returns `users`). |
| D33 | `backend/static/registry.tar.gz` is **committed to git**; `.gitignore` `/backend/static/*.tar.gz` does not match the already-tracked path. |
| D34 | Every dependency except `flask==2.2.4` is unpinned → non-reproducible builds. |
| D35 | `server.py` binds `0.0.0.0` with `debug=True` whenever `IS_CI != "true"` → the interactive Werkzeug debugger is network-reachable. |
| D36 | v2.0.1 `security_checks.yml` will hang: `validate.py` is now an infinite loop (`while True: validate(); time.sleep(60)`) but the workflow is a one-shot with no `timeout-minutes`. `main`'s version ran a single `validate()`. |
| D37 | v2.0.1 `backend/nginx/nginx.conf` reads `server.crt`/`server.key` while `scripts/generate-ssl.sh` writes `fullchain.pem`/`privkey.pem`. Latent, not live: the file is mounted by nothing, and the actually-wired root `nginx/nginx.conf` uses the correct filenames. |
| D38 | `utils/cache.py` and `utils/decorators.py` (~9 KB) are **entirely dead** — zero external references, and not even loaded at runtime because every importer targets a submodule directly. Seven of the ten exports in `utils/validators.py` are also unreferenced; `namespaces.py:36` defines a same-named function that shadows the utils version. |
| D39 | The maintainer's personal email is hardcoded as an `ALERT_EMAIL` fallback in **four** tracked places (`server.py:113,154`, `backend/compose.yaml:60`, `backend/compose.override.yaml:3`). The module-level `ALERT_EMAIL` at `server.py:154` is assigned and never read. |
| D40 | `frontend/.env.production` hardcodes `REACT_APP_REGISTRY_API_URL=https://64.226.81.128` with no `/api` prefix, while `docs/api-reference.md:8` documents a `/api`-prefixed production base — three mutually inconsistent answers. There is no `.env`, so `npm start` leaves `baseURL` `undefined`. |
| D41 | **54 discrepancies between `docs/` and the code**, catalogued in [`API_CONTRACT.md`](./API_CONTRACT.md) §7.6. The worst: `docs/api-reference.md` documents **201 Created + a JWT token** for signup (code returns 200 with no token), documents **JSON bodies** for authenticated routes that all read `request.form`, documents a **`/auth/refresh` endpoint and token rotation that do not exist**, and documents a **rate-limiting scheme with `X-RateLimit-*` headers that is not implemented anywhere** (only a 429 handler exists that nothing raises). `docs/authentication.md` documents password rules requiring upper+lower+digit+special; the code enforces **length ≥ 8 only**. |
| D42 | `docs/deployment.md` documents ~15 env vars that no code reads (`MAIL_SERVER`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `SECRET_KEY`, `UPLOAD_FOLDER`, `JWT_ACCESS_TOKEN_EXPIRES`, …) and healthchecks `localhost:5000` while the container listens on **9090**. |
| D43 | `tests/base_case.py::tearDown` calls `drop_database("testregistry")` with the name **hardcoded**, ignoring `MONGO_DB_NAME`. The suite therefore only cleans up correctly by coincidence: run it against any other database name and state persists between tests, producing spurious duplicate-account failures. Found by running the suite locally during the CI repair. |
| D44 | **`v2.0.1`'s CI has never passed.** `tests.yml` set `SUDO_PASSWORD: fortran` (7 chars) and `RESET_PASSWORD: reset` (5 chars) while `utils/validators.py` — added in the same branch — rejects passwords under 8 characters, and `test_sudo_user_signup` signs up with `SUDO_PASSWORD`. Every run on the Actions history fails; checked back to at least 2026-02-07, including all five runs on 2026-02-11. Fixed on `serverless-migration` (`ce89f6a`) and verified locally: 38 passed against a live MongoDB. Worth noting because `v2.0.1` was chosen as the migration base *specifically* on quality grounds. |
| D45 | The JWT test secret in `tests.yml` is 28 bytes, below the 32-byte minimum PyJWT recommends for HS256 (RFC 7518 §3.2), producing an `InsecureKeyLengthWarning` on nearly every test. Lengthened to 40 bytes. |

---

## 3. What this changes in the migration plan

| Plan phase | Change |
|---|---|
| **Phase 2** (DO connection pool) | Unchanged — still the CPU-critical path. |
| **Phase 3** (auth) | Adds **D1** (kill the `SUDO_PASSWORD` backdoor), **D2** (token-minting oracle), **D3** (CORS allowlist), **D6**. Carries forward `v2.0.1`'s bcrypt + legacy-migration design, switched to PBKDF2-SHA256 via WebCrypto for new hashes (bcrypt is not available under the 10 ms CPU budget — `bcryptjs` costs 50–100 ms). |
| **Phase 5** (package reads + cache) | Adds **D17** (build the full index set), **D18** (replace regex with an indexed search), **D19** (bound page size), **D25** (`$lookup` to kill N+1). |
| **Phase 6** (upload → R2) | Adds **D15** (`dry_run` must not write), **D24** (store a SHA-256 of the artifact), **D7** (validate the package-name charset before any path or shell use). |
| **Phase 7** (search) | Adds **D18**, **D26** (add the missing deprecation/un-deprecation API). |
| **Phase 8** (validation) | Adds **D7** (chmod-safe validation), **D8** (zip-bomb cap). Runs in GitHub Actions, so the shell-injection surface disappears with the ephemeral runner. |
| **New Phase 2b** | **Correctness sweep** for **D9**–D16, D20–D23: proper semver ordering, cascade deletes, correct `verify`/`delete_namespace`, `report/view` triage state, real HTTP status codes, a numeric `ratings` value, and a race-free rating counter. These are *fixes*, which the brief explicitly permits. |

### Contract impact of the fixes (all **additive or non-breaking**)

- `ratings`: `3.0` → `3` (the 1-tuple array is a bug; no frontend consumer reads it).
- HTTP status codes now match the `code` in the body — this makes the frontend *more* correct, since
  it currently renders a broken page for 404s because of the `error.data` vs `error.response.data`
  bug.
- `version_history` gains correct ordering.
- A `GET /packages/<ns>/<pkg>/deprecate` route is **new** — nothing depended on its absence.

---

## D46 — Archive download links 404 (found during integration, post-migration)

**Severity: high (user-visible, silent).** Found by cross-checking every URL the
frontend hard-codes against the Worker's router, after merging both branches.

`pages/archives.js` links each archive to `${API}/static/${name}`. That URL was
always correct in the Docker deployment — but **nginx** served the `static/`
directory. Flask never saw the request. So no backend route ever existed for it,
and no test covered it, because there was nothing to test: the path worked.

Removing the web server removed the only thing implementing it.
`handleTarballRoutes` claims the `static` prefix and has no branch for it, so
`GET /static/registry-2026-10-02.tar.gz` fell through to 404.

The archives page rendered working-looking links to files that 404'd, and nothing
in CI, the type checker, the linter or the build noticed. This is the failure mode
unique to *deleting a layer*: each side is internally consistent and the seam
between them was implemented by a component that no longer exists.

**Fixed two ways:**

1. `router.ts` routes `/static/{name}` to the archive handler, placed **above**
   the tarball branch that claims the prefix. Ordering is the whole fix, and the
   test asserts on ordering rather than mere presence.
2. The frontend now links `/archives/{name}`, the canonical path. The alias stays
   so a cached bundle keeps working.

**Regression test:** `worker/test/frontend-contract.test.ts` pins the URLs the
frontend hard-codes and asserts each is both documented *and* routed — the two
can disagree, which is precisely how this happened. Verified by reintroducing the
bug: the ordering assertion fails.

Two rounds of tightening the test were needed before it could actually fail. The
first version accepted `/archives/{name}` as a substitute for `/static/{name}`,
and the second checked only the route spec while the router stayed unpatched. A
test that passes against the bug it exists to catch is worse than no test, because
it is mistaken for coverage.

**Still open:** `/terms` and `/privacy` are linked in the footer and 404. Left
deliberate — inventing legal text is not a migration task — but flagged so it is
a decision rather than an oversight.

---

## D47 — The compatibility claim was never independently checked

**Severity: high (process, not code).** Found by running the
`migration-architect` skill's own `compatibility_checker.py` against the real
artifacts instead of trusting the migration's own summary.

The headline claim — "the API contract did not change" — had only ever been
asserted by the same code that made the changes. So the legacy surface was
reconstructed from git: 36 operations, recovered by walking the `@swag_from`
decorators in the Flask sources and resolving each to its YAML fragment. That is
the only way to recover the contract as it actually was.

**Run naively, the checker reported 47 breaking changes. 46 were artifacts:**

- Flask writes path parameters as `<namespace>`; OpenAPI writes `{namespace}`.
  A checker comparing path keys as literal strings calls all 7 of those a removed
  endpoint.
- Swagger 2.0 puts `formData` in `parameters`; OpenAPI 3 moves the same fields into
  `requestBody.multipart/form-data`. Without hoisting, `password`, `upload_token`
  and `tarball` all read as "removed required parameters".

After normalising both, and matching paths on segment shape rather than
parameter *names*:

| Verdict | Count | Meaning |
|---|---|---|
| PRESERVED | 28 | same method, same path |
| COSMETIC | 7 | `{namespace}` vs `{namespace_name}`; a client cannot tell |
| REMOVED, justified | 1 | `GET /tarballs/{oid}` |
| REMOVED, unexplained | 0 | — |

So the contract holds: 35 of 36 operations are byte-for-byte reachable, and the
36th is the one below.

**`GET /tarballs/{oid}` is genuinely, unavoidably gone.** `v0.0.1` emitted
`download_url = f"/tarballs/{file_object_id}"` — a GridFS ObjectId. Artifacts now
live in R2 under a key derived from namespace/package/version, and GridFS is not
used at all. A stored ObjectId identifies nothing in this architecture, so the URL
is **unserveable rather than merely unimplemented**: there is nothing to look up.
No amount of routing work recovers it.

A comment in `routes/tarballs.ts` had claimed the legacy shape was "handled for
backwards compatibility". It was not — only the 4-segment branch existed. The fix
was correcting the comment, because there is no code that could satisfy it.

**Two documentation defects the check surfaced:**

1. `POST /packages/{ns}/{pkg}/maintainers` — `v0.0.1` registered
   `methods=["GET","POST"]`, and the router has always served both, but the spec
   declared only the GET. The POST read as dropped when it never was.
2. `POST /users/admin/transfer` — routed, returning a deliberate 501, and absent
   from the spec entirely. `openapi.test.ts` did not catch it because it was
   circular: it asserted spec → document, so a route present in the router and
   absent from the spec passed. There is now an anti-circular assertion that
   every `501` the router can emit is documented.

**The gate is now committed** as `scripts/check_api_compat.py`, so the claim is
reproducible rather than a one-off. Verified it can actually fail: removing
`GET /report/view` from the spec produces `REMOVED-UNEXPLAINED` and exit 2;
restoring it returns to the documented state. Justified removals are an
allow-list, so a *new* unexplained removal fails CI while a known one does not.

Its limitation is documented rather than glossed: the gate compares legacy → new,
so it is blind to the deletion of a route this migration *added*. Verified by
removing `/auth/refresh` and watching the gate pass. The reverse direction is
covered by `openapi.test.ts` and `frontend-contract.test.ts`.

---

## D48–D52 — Found by running the Worker against real data

**Severity: D49 and D50 are critical — every read route 500'd in production.**

Until this point the migration had been verified by type checking, linting, 266
unit tests (26 of them against live Atlas), a bundle dry-run and the OpenAPI
validator. All green. Then the Worker was actually *run* — `wrangler dev` against
the real cluster, with seeded documents, and every documented route requested.

Every one of these is invisible to a unit test that does not hold a real document.

### D49 — BSON ObjectId could not cross the Durable Object boundary (critical)

`Could not serialize object of type "_ObjectId". This type does not support serialization.`

workerd's RPC layer cannot serialise a BSON `ObjectId`. `#run` returned raw
driver results, so the DO → Worker hop threw and turned every read route into a
500: `/packages`, `/packages/{ns}/{pkg}`, `/namespace/{ns}`.

It hit every read because the driver returns `_id` as an ObjectId unless a
projection excludes it, and Mongo's `$project` includes `_id` by default.

Fixed at `execute()`, the single RPC boundary, by a `toRpcSafe` conversion.

**The fix then broke everything it touched**, which is the more interesting part.
`toRpcSafe` emits ids as hex strings, and handlers feed a returned `_id` straight
back into the next filter — around thirty call sites do this. Measured against
MongoDB 8.0.34 with driver 7.7.0:

| Filter | Matches |
|---|---|
| `{ _id: ObjectId(...) }` | 1 |
| `{ _id: "<24 hex>" }` | 0 |
| `{ namespace: ObjectId(...) }` | 0 |
| `{ namespace: "<24 hex>" }` | 0 |

So the driver does **not** coerce a hex string to an ObjectId — not even on an
`_id` path. This is the opposite of what `worker/src/lib/ids.ts` asserts:

> "The MongoDB driver converts a 24-character hex string into an ObjectId
> automatically when it is used against `_id`"

That comment is now known to be false and was inherited from the earlier defect-D11
work. Correcting it matters more than the code: it is the kind of claim that makes
the next author skip the check.

Fixing thirty call sites individually would work until the next author forgot one,
and a forgotten one is a silent zero-match — no error, just an empty result that
reads as "not found". So the conversion happens once, in the DO, over every query
fragment (`toBsonQueries`). Its one assumption: a 24-hex-character string is an
id. Checked against the schema, the only other hex-valued fields are `sha256` and
upload-token digests, both 64 characters. Recorded in the code because a future
24-hex non-id field would silently change meaning.

### D50 — `/namespace/{ns}` joined on the wrong key (high)

`$lookup` joined `namespaces.packages` — an array of package **name strings** —
against `packages._id`, a list of ObjectIds. Never matches. Every namespace
reported `packages: []` at HTTP 200, which looks like a legitimate empty state.

The same pipeline had `$unwind` followed by `rows[0]`, so even a correct join
would have capped the response at a single package.

Fixed to join `_id` → `packages.namespace`, which is the real foreign key.

### D51 — Public profile listed the *viewer’s* packages and namespaces (high)

`GET /users/{username}` filtered `packages.author` on `viewer?._id` instead of the
profile owner's id, and omitted `_id` from its own projection, so there was no
owner id to filter on. The result was correct only when you opened your own
profile; for any other username — and for an anonymous visitor, which is how a
public profile page is normally first loaded — the filter was `author: undefined`,
matching nothing. `packages: []` and `namespaces: []` at HTTP 200.

Both filters now use the profile owner.

### D52 — `/packages_cli` was documented but never implemented (high)

Phase 9 generated the OpenAPI document from the route table and listed
`/packages_cli`, recovered from `packages.py`'s `@swag_from`. No handler was ever
written: the route was published in the API spec and answered 404.

Documenting a route that does not exist is worse than omitting it. A client
generator emits a method for it, and a reader trusts the spec. `fpm search` depends
on it.

It is not a copy of `/packages`. The two disagree observably and both were kept:
`page` is **1-based** here and 0-based there; `*` is an "any" sentinel; an empty
result is a **404** here (`{"status":"error", ...}`) and 200-with-`[]` there; and
entries carry a flattened `version` string rather than `latest_version_data`.
Copying `/packages` would have silently broken all four.

### D53 — `/health` reported an outage it never tested (medium)

`health()` returned `connected: false` whenever `#client` was null. The DO
connects lazily, so a **cold** Worker reported a database outage that had never
been diagnosed. Meanwhile `/packages` was successfully reaching MongoDB and the
only genuine fault was a missing text index.

A health signal exists to point an incident at the right subsystem, and this one
pointed at the wrong one. It now connects if needed and actually verifies:
absence of evidence is not evidence of disconnection.

### Also fixed while here

- **No `migrations`/`exports` declaration for the Durable Object.** `wrangler`
  rejects a deploy without one.
- **`vars`, `durable_objects` and `kv_namespaces` are not inherited by an `env`
  block.** The `staging` and `production` blocks overrode only `vars` and
  `r2_buckets`, so `wrangler deploy --env production` produced a Worker with **no
  `MONGO_POOL` and no `CACHE`** — silently, with no error. Every database route
  would have failed in production while the same code passed every other check.
  Both environments now declare them explicitly, and
  `worker/test/wrangler-config.test.ts` asserts it.
- **`PBKDF2_ITERATIONS` was top-level only**, so both environments would have
  silently fallen back to a different KDF cost.
- **Production's KV placeholder had been copy-pasted from staging**, so both
  environments named the same cache-invalidation namespace.
- `total_pages` reported 1 for an empty result set.

### The test gaps this exposed

1. `openapi.test.ts` was **circular**: it asserted spec → document, so a route
   present in the router and absent from the spec passed. Now also asserts the
   reverse — every documented segment appears in an entry point — and every `501`
   the router can emit is documented. Verified by reintroducing D52 and watching
   it fail.
2. No test asserted a `$lookup` actually **joined**. D50's pipeline returned a
   well-formed empty result, so every status-code assertion passed.
3. The 26 live-Atlas tests never returned an ObjectId through the RPC boundary,
   because their projections happened to avoid it.

**The honest summary: none of D49–D53 could have been caught by any amount of
unit testing.** They needed the process running against documents that exist.

---

## D54 — Dark mode rendered the navbar at 1.11:1, and the Register CTA had no background

**Severity: high (accessibility). Found by rendering the site.**

This is the gap I had flagged as unverified for most of the migration. The
redesign shipped a contrast table of 53 measured pairs, all correct, and the dark
theme was still unusable.

### What the browser actually showed

Measured with `getComputedStyle` on the rendered DOM, both schemes:

| Element | Light | Dark (before) | Verdict |
|---|---|---|---|
| `fpm registry` wordmark | `rgb(0,0,0)` on white | `rgb(0,0,0)` on `rgb(22,22,30)` | **1.17:1** |
| `Archives` / `Help` / `Login` | fine | `rgba(0,0,0,.65)` on `rgb(22,22,30)` | **1.11:1** |
| `Register` CTA | **1.0:1** | **1.11:1** | invisible |

Both fail AA for normal text, **and** for large text, **and** for UI components.
Confirmed against `a11y-audit`'s `contrast_checker.py`, not my own arithmetic.

### Cause 1 — `data-bs-theme` was never set

Bootstrap 5.3 gates its **entire dark palette** on `[data-bs-theme=dark]`. The
theme sets `data-theme`, a different attribute, and never mirrored it. So
Bootstrap stayed in light mode inside our dark theme, and `.navbar` declared its
light default `--bs-navbar-color: rgba(0,0,0,.65)` — black on a black background.

`applyTheme()` now mirrors `data-theme` onto `data-bs-theme`, and so does the
inline pre-paint script in `public/index.html`, which `theme.js` explicitly
warned must be kept in sync. One mechanism fixes every Bootstrap component at
once, which is why it is worth having rather than patching component by component.

### Cause 2 — `.nav-link` outranks the theme's own link rule

`.nav-link { color: var(--bs-nav-link-color) }` is specificity (0,1,0) and beats
`a { color: var(--color-link) }` at (0,0,1), so the nav links took Bootstrap's
colour rather than the palette's.

Fixed by overriding the **variable** on the container, not the property:

```css
.navbar-nav { --bs-nav-link-color: var(--color-text-muted); }
```

`.nav-link`'s own rule reads that variable, so there is no specificity contest.

Selector note: `react-bootstrap`'s `<Nav>` renders `<div class="navbar-nav">`, not
Bootstrap 4's `<ul class="nav">`. My first attempt scoped to `.nav`, matched
nothing, and did nothing at all — a colour rule that never matches is worse than
none, because it reads as deliberate.

### Cause 3 — the Register CTA never had a background

It is both `.nav-link` and `.btn-primary`, and Bootstrap gives `.nav-link` a
`background: 0 0` **shorthand**, which resets `background-color`. Equal
specificity, later in source order, so `.nav-link` won and `--bs-btn-bg` was
computed correctly (`#5b53c0`) while the rendered background stayed
`rgba(0,0,0,0)`. White text, no button behind it.

Restated as the longhand at (0,2,0). A `background` shorthand here would have
reintroduced the same reset.

This one is not caused by the migration and predates it — the CTA has been a
transparent white-on-white button since the redesign. It read as an "unstyled
link" in every screenshot, which is exactly the kind of thing a design review
skips over.

### Why no existing check caught any of it

The token audit reads `tokens.css`. Every token *was* correct. These defects live
in the cascade, in a framework the theme does not own. There is no static analysis
of a token file that will ever report "Bootstrap's navbar variable is winning".

Verified after the fix, from the rendered DOM:

| Element | Dark (after) | Verdict |
|---|---|---|
| wordmark | `rgb(255,255,255)` on `rgb(22,22,30)` | 17.99:1 — AAA |
| nav links | `rgb(185,186,194)` on `rgb(22,22,30)` | 8.03:1 — AAA |
| Register CTA | `rgb(6,6,19)` on `rgb(142,143,239)` | 7.02:1 — AAA |

And the whole suite, 11 routes × 2 viewports × 2 schemes: **66/66 structural
checks, 0 unhandled exceptions, 0 failed requests**, no empty canvases, no glyphs
that failed to load, exactly one `<main>` per page.

### Guards added

- `.github/workflows/worker.yml` gains a `theme-contract` job asserting both theme
  writers set `data-bs-theme`, that the nav override targets `.navbar-nav`, and
  that the CTA restates `background-color` as a longhand. The third one exists
  because a rule that never matches reads as deliberate.
- `scripts/frontend_visual_audit.cjs` is the audit itself, committed so the
  claim is reproducible. Not in CI: it needs a browser and a running API.

### Also fixed

The dev CORS allowlist named only `http://localhost:5173`, so a browser reaching
`http://127.0.0.1:5173` was silently blocked — no error in any log, the response
just never reaches the app. Both loopback spellings are now allowed, and an
unlisted origin still gets nothing.

---

## D55–D58 — The write path had never been exercised

**Severity: D55, D57 and D58 are critical. Found by running the write path.**

D49 fixed the read path. Nothing had ever exercised a **write** — and writes are
the larger, riskier half: authentication, publish to R2, ratings, deprecation, and
three cascade deletes. A broken read fails visibly; a broken write fails *silently
and corrupts state*.

`scripts/write_path_audit.mjs` drives the whole write surface against the live
cluster and asserts on the response **and** on the resulting database state. That
second half is the point: the recurring legacy failure is "HTTP 200 with a message
claiming success", which a status-code assertion cannot see.

It found four product defects and four bugs in the harness itself.

### D55 — Every cascade delete silently deleted nothing (critical)

`POST /namespace/<ns>/delete` answered `code: 200, "Namespace deleted
successfully"` and the document was still there. Same for `delete_package` and
`delete_user`.

Root cause was D49's own fix, incompletely applied. `toRpcSafe` must stringify
ObjectIds because workerd cannot serialise them, so `toBsonQueries` converts hex
back to ObjectId on the way out to queries. That was wired into `#run` and into
transactional **inserts** — but not into a transaction's **filters**. Every
cascade delete runs inside a transaction, so `{_id: "<24 hex>"}` matched zero rows
and the step silently no-opped.

This is the worst shape a bug can take. The audit register recorded
`delete_namespace` as already fixed — "compared the namespace name against an
ObjectId, so it never deleted anything and always returned code:500 at HTTP 200".
The defect was still present; only the status code had improved to `200`. A
migration that fixed the code but kept the guarantee is worse than one that left a
loud failure in place.

The unit tests missed it because they asserted object identity, not that a
document actually disappeared.

### D56 — Deprecating a package never reached the client (high)

`PUT /packages` set `is_deprecated` on the **package document**, but the API
returns `is_deprecated` / `isDeprecated` per **version**, and the frontend reads
the version field. So the route answered `200 "Package deprecated successfully"`
while `isDeprecated` stayed `"false"` on every version — the badge never appeared.

That is the same defect as the one this migration set out to close. `v0.0.1` had no
deprecation route; adding one that reports success without changing what the client
reads is the same bug wearing a 200.

Now writes both, using `versions.$[]` — there is no dotted path for assigning
across an array of subdocuments. Verified end to end: deprecate → the API reports
`"true"`, the package drops out of search; un-deprecate → the version flag returns
to `"false"` and it reappears.

### D57 — App-written id references were stored as strings (critical)

A direct consequence of D49. `POST /packages` published a package whose
`namespace` was the **string** `"6abf72a8..."` rather than an ObjectId, because it
copied `_id` off a fetched document — which `toRpcSafe` had turned into a string —
straight into the insert. `insertOne` was not passed through `toBsonQueries`.

Every subsequent read of that package 404'd, while a package inserted with a real
ObjectId worked fine, which is exactly why the read tests had all passed. Same
problem in `ratings.package_id` and `ratings.user_id`.

Both insert paths — plain and transactional — now convert.

### D58 — `POST /users/delete` returned 500 for any namespace author (high)

`Cannot apply $pull to a non-array value`. The cascade ran
`$pull: { author: <id>, admins: …, maintainers: … }` over every namespace, but
`namespaces.author` is a **scalar** ObjectId, not an array. `$pull` on a non-array
throws, and because the cascade runs in a transaction the exception rolled the
whole thing back — so the endpoint 500'd and deleted nothing for any user who had
authored a namespace.

Split into two steps: `$pull` for the arrays, `$set: {author: null}` for the
scalar.

### Four bugs in the harness itself

Worth recording, because the first instinct on each was to suspect the product:

- **`POST /users/admin` returns 401 for a non-admin**, not `isAdmin: "false"`. It
  is an admin-only probe, not a role query. The harness was wrong.
- **Upload tokens live in their own `upload_tokens` collection**, not on the
  namespace document — `v0.0.1` pushed them onto `namespaces.upload_tokens[]`
  forever with no sweep (D4). The harness looked in the wrong place.
- **Ratings are stored inside the package document** at `ratings.users.<userId>`,
  not in a collection, so concurrent votes cannot lose each other. Harness again.
- **Deleting a package's last version deletes the package** ("no longer
  installable"), so a following package-delete correctly 404s. The harness created
  its own absence and then called it a defect.

The harness now asserts the admin boundary explicitly — a non-admin is refused,
nothing changes — and only then promotes a user to exercise the real cascade.

### The test gap this exposed

No test asserted that a document **disappeared** after a delete. Every cascade
test checked the response and, at most, that the call did not throw. A delete that
reports success and does nothing passes all of them.

`write_path_audit.mjs` asserts on database state after every mutating step, and is
committed so the claim is reproducible. Not in CI: it needs a running Worker and a
live cluster, and it mutates state.

---

## D59 — A publish that lost the create race failed instead of folding in

**Severity: medium (availability). Found by concurrency testing.**

`scripts/write_path_fuzz.mjs` drives the upload and rating paths with hostile
input and with genuinely parallel requests. Hostile input came back clean — every
one of 15 rejected, and all 8 injection-shaped searches left the database intact.
Concurrency found one defect, and fixing it surfaced a second that I introduced.

### D59 — five parallel publishes, one version

`packages_name_namespace_unique` is a unique index on `(name, namespace)`. Five
concurrent *first* publishes of the same package therefore produce exactly one
insert; the other four got a duplicate-key error and were returned as failures.
Measured: five parallel publishes of five different versions left **one** version
on the package.

The index is behaving correctly. Failing the publish is not the right response: the
package now exists, and it is exactly where that version belongs. This is not
theoretical — a CI matrix publishing several versions of one package at once
loses all but one.

The insert now catches the duplicate key and folds the version in with an atomic
`$push`.

**And `err.code` did not survive the RPC boundary.** The first attempt still
returned HTTP 500: the error is raised inside the Durable Object and re-thrown
across workerd's RPC layer, which does not carry arbitrary properties, so
`err.code === 11000` never matched and only the message survived. Detection now
checks the code *and* the `E11000` prefix, which is stable MongoDB output rather
than prose.

### D60 — six copies of the same version (introduced by the D59 fix)

Folding the losers into `$push` made the same-version race worse: a bare `$push`
is atomic but **not idempotent**, so eight concurrent publishes of 1.0.0 inserted
eight identical entries — six surviving copies, which then appear in
`version_history` as `1.0.0` repeated.

Caught because the harness asserted on the *stored* version list rather than on
the response. A check that only counted HTTP 200s would have passed this happily.

The append now carries `"versions.version": { $ne: version }` in its filter, which
keeps it atomic — exactly one request matches and pushes, the rest match zero
documents and are told the version already exists.

### What came back clean, and is worth recording

- **15 hostile uploads all rejected** with nothing written: path traversal (`a/b`,
  `..`), a null byte, a shell metacharacter (`a;rm -rf /`), an over-length name,
  version `0.0.0`, a non-semver version, a version containing `/`, an empty
  license, a missing tarball, and a 50 MB + 1 KB artifact (413).
- **8 injection-shaped searches** (`"; dropDatabase(); //`, `.*`, `^`, `\`,
  `{"$ne": null}`, 600 characters, `<script>`, `%00`) all returned 200 or 400 and
  left every collection present. `$text` plus the capped query length means the
  user's string never reaches a `$regex`.
- **Ratings are genuinely race-free.** Ten accounts voting simultaneously: 10/10
  accepted, 10 votes stored, and the derived average was exactly 3.0 — which is the
  correct mean of the 1..5 values submitted. This is the D25-class defect
  *actually* fixed, verified rather than asserted.
- **Duplicate namespace creation** is correctly serialised by its unique index:
  five racing creates yielded one document and one 200.

### The gap

The concurrency claims in the migration — "race-free rating counter", "atomic
$push" — were argued from first principles, not measured. Reasoning about races is
how D59 and D60 both existed: the first because nobody imagined two CI jobs
publishing at once, the second because it was introduced by a fix for the first.


---

## D41 closed — rate limiting, documented but never implemented

**Severity: high (availability).** D41 recorded that `docs/api-reference.md`
documents a rate-limiting scheme with `X-RateLimit-*` headers that is "not
implemented anywhere", alongside a 429 handler that nothing raises. Now implemented
as documented.

Two bugs were found while doing it, both in the new code.

### Counter keyed by client alone, so the three budgets collided

`#rateCounters` was keyed by `clientKey(...)` with no bucket component, so the
auth, upload and general counters shared one slot per client. Auth traffic ate the
upload allowance and vice versa, and every client effectively got the tightest of
the three limits.

Measured: a brand-new client that had signed up and logged in — two auth requests
— then saw `X-RateLimit-Remaining: 2` on its **first** upload, against a budget of
5.

The first live check missed it because every probe used a distinct address and made
requests of only one kind, so the collision never arose. Finding it required a
client that made requests of more than one kind, which is exactly what a real user
does and a synthetic probe does not. The key now includes the bucket.

### Turning the limiter on broke the verification harnesses

`write_path_audit.mjs` fell from 69/69 to 49/69 the moment the limiter was
enabled: its three uploads exceeded the 5/hour budget and everything downstream
failed. A harness that cannot verify anything is worse than no harness, so both
harnesses now give each synthetic client its own source address, which is what
independent CI runners look like.

This is not working around the control. Per-address limiting of anonymous traffic
*is* the documented behaviour, and the harnesses now depend on it working — the
fuzz harness's publisher pool genuinely cannot be created from a single address,
because eight signups exceed the 10/minute auth budget.

The same exercise surfaced a real harness bug: the racing-publish probes had been
switched to a pool publisher's token, but a publish token is **scoped**, so the
package landed in that publisher's namespace rather than the one under test. The
probes now use the namespace-scoped token with distinct addresses, which also
makes them more faithful — the unique-index race is on `(name, namespace)` and is
global, not per client.

### Design decisions, and what each costs

| Decision | Reason | Cost accepted |
|---|---|---|
| Per account, not per address | a NAT or shared CI runner puts many users behind one IP; per-address lets one deny service to the rest | one extra HMAC verify per request — no DB round trip, no KDF |
| Durable Object, not KV | KV is eventually consistent, so a counter there under-counts and therefore does not rate limit | one DO round trip, on routes that already make one |
| Durable Object, not Worker memory | isolates are ephemeral and numerous; an in-Worker counter is per-isolate and trivially bypassed | — |
| Cache hits not counted | flooding cached reads is the cheap way to load the registry; Cloudflare serves them and the Atlas cap is untouched | a cache-flooding client is not limited |
| Fails open | a limiter that breaks and takes the API down with it adds availability risk rather than reducing it | no protection while the counter store is down |
| Fixed window | one counter and one timestamp per key; no eviction sweep, bounded memory | a boundary burst of up to 2x the limit |

### Verified against the live cluster

`scripts/rate_limit_probe.cjs`, 16/16:

- auth refused on request **11**, first ten not refused
- general refused on request **101**
- upload bucket is **5**, distinct from the others, refused on request 6
- refusals carry `X-RateLimit-Limit`, `Remaining: 0`, `Retry-After`, and a `code: 429` body
- a different address keeps its own budget
- `/health`, `/`, `/apidocs` and `/apidocs/openapi.json` are exempt
- CORS headers survive alongside the rate headers

25 unit tests, each verified to fail under mutation: dropping the negative clamp,
removing the window reset, widening the upload bucket to all writes, allowing
`remaining` to go negative.


---

## D65 — every non-admin was logged out one second after logging in

**Severity: critical. Found by driving the login form, which nothing had ever done.**

### What it looked like from outside

Log in as any ordinary user. The navbar fills in with your username, a spinner
appears ("Loading your dashboard…"), and then the session evaporates and you are
back at the sign-in card with the fields still filled. Sign in again, and the
same thing. Repeatable, and total: **only a user whose `roles` contains `admin`
could stay signed in at all.**

### Why

Three pieces, each individually reasonable:

1. `NavBar` runs an effect on sign-in: `if (isAuthenticated && accessToken)
   dispatch(adminAuth(accessToken))`, to decide whether to show the admin menu
   item. That is `POST /users/admin`.
2. The API answers **401** to a caller who authenticated successfully but is not
   an admin. It has answered 401 since `v2.0.1`; the status is frozen by
   `scripts/check_api_compat.py`, and `worker/src/routes/users.ts:250` documents
   returning the *string* `"true"` precisely because the frontend's comparison of
   that response is contract-bound.
3. `apiClient`'s response interceptor ends the session on any 401 that arrived on
   a request carrying an `Authorization` header, commented as: *"Only responses to
   requests that actually carried a token are treated as session expiry."*

Step 3's reasoning is the defect. It assumes a 401 means the token was rejected,
and reasons from the presence of the header. But the API also answers 401 to a
caller whose token is **fine** and who simply lacks the permission. The navbar
probes for admin rights the instant you sign in, that probe returns 401 by
design, and the interceptor concluded the session had expired — clearing the
token and navigating back to `/account/login`.

### Why nothing caught it

Every previous check tested one side or the other:

- the API harnesses called the API, and a 401 from `/users/admin` is the correct
  answer, so they passed;
- the review pass rendered all 21 routes, but **signed out** — the navbar's admin
  probe never runs, so the trap never arms;
- `scripts/frontend_review.cjs` injected API failures into pages, never into the
  session lifecycle.

Nobody had put a real login into the browser. The gap was the journey, not the
code.

### The fix

Status stays **401**; the body gains a marker. `v2.0.1` answered every
authorisation failure with 401 and the contract is frozen, so changing the status
would break every existing client to buy nothing — what a client needs is to know
*which kind* of 401 it is, and that fits in the body.

- `worker/src/lib/responses.ts`: new `jsonForbidden()`, which is
  `jsonError(401, message, { reason: "forbidden" })`.
- 16 permission checks across `packages.ts`, `namespaces.ts`, `users.ts` and
  `ratings.ts` now answer with it — every site where a user has been resolved and
  the denial is about rights rather than identity.
- `frontend/src/store/utils/apiClient.js`: the interceptor skips `emitUnauthorized()`
  when `reason === "forbidden"`.

Additive: a client that does not know the field behaves exactly as before, so
`scripts/check_api_compat.py` is unaffected (still the one pre-existing D28 warn,
the one justified removal).

### The wider blast radius, which is why it was marked everywhere

The navbar probe is only the first place a signed-in user meets a 401 they are
still alive to receive. Every one of these is a normal thing to attempt:

| Attempt | Answer before the fix |
|---|---|
| non-admin opening any admin-gated view | 401 → signed out |
| maintainer deleting a package they do not own | 401 → signed out |
| maintainer removing another maintainer | 401 → signed out |
| namespace author granting admin without the right | 401 → signed out |
| user editing another user's account | 401 → signed out |

Each would have logged the user out at the moment they were told "no", which is
also the moment they are most likely to try something else.

### Guards

- `worker/test/forbidden-marker.test.ts` — `jsonForbidden()` keeps the 401 status,
  marks the body, and preserves a custom message; a plain `jsonError(401)` stays
  unmarked, so absence still means "session over". The second test scans the route
  sources and fails if any permission guard answers with an unmarked 401, which is
  what catches a site missed in the sweep. A third test asserts the marker is
  reached at least 16 times, so the scanner cannot rot into a no-op by quietly
  ceasing to match. **Verified by mutation**: reverting the `isSiteAdmin` site in
  `users.ts` to `jsonError(401, …)` fails two of the three.
- `scripts/auth_journey.cjs`, 27/27 — signs a real account in and asserts the token
  is persisted, rehydrated after a reload, still sent on authenticated requests,
  and cleared on sign-out. Before the fix this reported **9/21**.

---

## D66 — the skip link was never the first tab stop

**Severity: minor. Found by the same journey, in its keyboard pass.**

`HomeSearchField` called `inputRef.current?.focus()` on mount, putting the caret in
the home page's search box before the user had asked for anything.

`App.js` implements a skip link as the first element of the tree and documents
this exact hazard in `useRouteChangeReset`: *"stealing it into `<main>` would
suppress the skip link as the first tab stop."* The home page suppressed it a
different way. Measured, the first five tab stops on `/` were:

```
search-suggestion, search-suggestion, search-suggestion, search-suggestion, quick-link
```

Two further consequences beyond the wasted keystroke: a screen reader announced a
text box rather than the page heading, so the landing page opened on a form field
with no context; and on a phone the on-screen keyboard rose over the hero before
any input was intended.

Removed. The hero invites the search; it does not perform it. The ref is kept — it
is the natural handle for that input — but nothing moves focus on mount. First five
tab stops now:

```
skip-link, d-flex, dropdown-toggle, theme-toggle, form-control
```

---

## D67 — a namespace description was write-only

**Severity: minor (data loss of user effort, not of data). Found by driving the
namespace form through the browser, which nothing had ever done.**

### What it looked like

Create a namespace. Type a description into the second field — the form requires
it, so it cannot be skipped. Land on the namespace page. The name is there, the
date, Admins, Maintainers, Packages. **No description.**

Come back a week later and write it again, because there is nowhere to see the one
you already wrote.

### Why

Two independent omissions, either of which alone would have hidden it:

1. `worker/src/routes/namespaces.ts` — `POST /namespaces` accepted `description`,
   validated it and stored it. `GET /namespace/{ns}` then ran an aggregation whose
   `$project` carried **only** `createdAt` and `packageDocs`. The field was never
   selected, so it could not reach a response.
2. `frontend/src/pages/namespace.js` — no reference to `description` anywhere. The
   action did not read it, the reducer did not hold it, the view did not render it.

There is no namespace *list* endpoint (`POST /namespaces/{ns}/admins` and
`/maintainers` are member lists), so the description was surfaced **nowhere** in the
product.

### Why nothing caught it

`write_path_audit.mjs` exercises every write at the API level and passes 69/69. It
asserts the document lands in MongoDB — which it did. The description *was*
stored, correctly, with a validated value. Every existing check looked at the
write and never at the read-back through the UI.

Same gap as D65, one layer over: the browser boundary.

### The fix

- `worker/src/routes/namespaces.ts`: `description: 1` added to the projection, and
  the response coerces it with `typeof row.description === "string" ? … : ""` so
  namespaces predating the field yield `""` rather than `undefined`.
- `store/actions/namespaceActions.js`, `store/reducers/namespaceReducer.js`:
  carried through, defaulting to `""` at the shape boundary.
- `pages/namespace.js` + `namespace.css`: rendered beneath the title, and **only
  when non-empty**, so the namespaces created before this existed look unchanged.
  `overflow-wrap: anywhere` because the text is free-form from a form and a long
  unbroken token would otherwise force a horizontal scrollbar on a phone — the same
  failure D64 fixed on two other pages.

Additive, so `scripts/check_api_compat.py` is unchanged.

### Guards, and a weak guard caught in the act

- `worker/test/live-namespaces.test.ts` asserts the aggregation projects
  `description` at the **namespace** level, and that the response coerces a missing
  value to `""`.

Two things went wrong writing that test, both recorded because both produced a
green run that meant nothing:

- The window was sliced from the projection offset to `start + 1200`. The function
  body is longer than 1200 characters, so the end preceded the start, `slice`
  returned `""`, and the assertion failed for a reason unrelated to the code under
  test.
- The assertion was then `toContain("description: 1")` — and the nested
  `packageDocs` sub-projection **also** contains `description: 1`, for packages.
  Deleting the namespace's own field left the test passing. Found by mutation:
  the test reported `2 passed` with the defect reintroduced.

It is now anchored on `packageDocs`, requiring the field to appear *before* it, and
re-verified: reintroducing the deletion fails the test.

The end-to-end half is `scripts/write_journey.cjs`, 14/14 — it creates a namespace
through the form and asserts the description reappears on the namespace page.

### Also fixed while in the file

The five navigation items in the signed-in dropdown were `<a>` with no `href`,
performing navigation via `onClick`, while the signed-out nav beside them had been
converted to real `<Link>`s earlier. Middle-click, ctrl-click, status-bar preview
and "copy link address" all did nothing. They are now `as={Link} to=`, verified by
clicking through each and checking the path. `Logout` is deliberately left as an
`onClick` item: it is an action, not a destination, and giving it an `href` would
imply a page to open in a new tab. The now-unused `handleNavigation` callback was
removed rather than left as dead code.

---

## Harness finding — the intermittent signup failure was my own sleep

Recorded because it was reported as an unresolved application defect last round and
it was not one.

Registration failed intermittently, roughly one run in three, with the harness able
to say only "no document". Two wrong guesses were made before the response body was
simply read. The button state at the moment of failure gave it away — the page said
**"Creating account…"**, so the request was still in flight.

Measured over four consecutive runs:

| run | `POST /auth/signup` | document visible in MongoDB |
|---|---|---|
| 1 | 1010 ms | ~1600 ms |
| 2 | 1186 ms | ~1610 ms |
| 3 | 1185 ms | ~1631 ms |
| 4 | 1321 ms | ~1649 ms |

Both harnesses slept a fixed 1400 ms and 1500 ms respectively. **The sleeps were
shorter than the real latency**, so the assertion raced the request. Nothing in the
application was wrong.

A fixed sleep is a race that passes on a fast machine and fails on a loaded one, so
all three were replaced with a wait on a condition:

- `_signed_in.cjs` polls for the account document.
- `auth_journey.cjs` waits for the submit button to leave its `disabled` state,
  which is the app reporting the round trip rather than a timer guessing at it.
- sign-out polls for the token to actually clear.

Three consecutive journeys after the change: 27/27 each.

Worth noting for the eventual production deploy: ~1.0–1.3 s for signup is the
PBKDF2 key derivation (176 ms of CPU, which is why it runs in the Durable Object
rather than the Worker, where the Free plan allows 10 ms) plus a Durable Object
round trip and an Atlas write. It is not a defect, but it is the number a user
waits through, and the button correctly shows "Creating account…" throughout.
