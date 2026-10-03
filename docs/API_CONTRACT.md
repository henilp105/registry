# API Contract — frozen baseline for the serverless migration

> **Status:** Frozen · **Date:** 2026-10-02 · **Source of truth:** `frontend/src/store/actions/*` +
> `frontend/src/store/utils/apiClient.js` (the actual consumer) on `v2.0.1`, cross-checked against
> `backend/**/*.py` and `backend/documentation/*.yaml` on `v2.0.1`.
>
> ⚠️ **This contract was first derived against `main` and then re-derived against `v2.0.1`.**
> §7 records every correction. `v2.0.1` is the base branch — see
> [`BASELINE_AUDIT.md`](./BASELINE_AUDIT.md) §1.
>
> This file is **Phase 0** of [`SERVERLESS_MIGRATION_PLAN.md`](./SERVERLESS_MIGRATION_PLAN.md).
> Every later phase is gated on contract tests derived from this document. If a change here is
> required, it MUST be additive or coordinated with a frontend change in the same PR.

---

## 1. Transport rules (non-negotiable)

| Rule | Detail |
|---|---|
| **Success** | HTTP `2xx` **and** JSON body containing `"code": 200`. 45 call sites branch on `result.data.code === 200`. |
| **Error** | HTTP **non-2xx** AND JSON body `{ code, message }`. axios rejects on non-2xx; 29 sites read `error.response.data.message`. |
| **Request encoding** | `multipart/form-data` (`FormData`) on **every** POST/PUT except `POST /auth/logout` (no body). |
| **Token field naming** | Wire format is **snake_case**: `access_token`, `refresh_token`. Redux state is camelCase (`accessToken`). Do not unify. |
| **`uuid` field** | Sent as a **form field**, not a header. See §4. It was always absent and 8 of its 10 call sites omitted `Authorization` entirely; the frontend now sends the Bearer header on every request. Where the field is still *sent*, it is a **single-use token**, not an identity (`reset-password`, `verify-email`). |
| **`createdAt`** | Must serialise as a **string of ≥ 16 chars**. `namespace.js` does `.slice(4,16)`, `accountActions` does `.slice(0,16)`. A BSON `Date` serialising to `{}` will crash the UI. |
| **`ver.isDeprecated`** | 🔴 **See §7.3.** The frontend reads `ver.isDeprecated === "true"` but `v2.0.1` emits `is_deprecated` as a **boolean**, so every version renders "Active". We must emit **both** keys. |
| **`ver.download_url`** | A **root-relative path beginning with `/`**, concatenated straight onto the API base URL. |
| **`isAdmin`** | `POST /users/admin` returns the **string** `"true"`, not a boolean. Preserve. |

---

## 2. Endpoint inventory (43 routes on `v2.0.1`, all `multipart/form-data` unless noted)

### 2.1 Auth — `/auth`

| Method | Path | Form fields | Auth | Response |
|---|---|---|---|---|
| POST | `/auth/login` | `user_identifier`, `password` | — | `{code:200, message, access_token, refresh_token, username}` |
| POST | `/auth/signup` | `username`, `email`, `password` | — | `{code:200, message}` |
| POST | `/auth/logout` | *(none)* | `Bearer` | `{code:200, message}` |
| POST | `/auth/forgot-password` | `email` | — | `{code:200, message}` |
| POST | `/auth/reset-password` | `password`, `uuid` | — | `{code:200, message}` |
| POST | `/auth/reset-password` ⚠️ 2nd caller | `oldpassword`, `password`, `uuid` | — | `{message}` only, **no `code` check** |
| POST | `/auth/change-email` | `new_email`, `uuid` | — | `{message}` only, **no `code` check** |
| POST | `/auth/verify-email` | `uuid` | — | `{code:200, message, access_token, refresh_token}` |

> ⚠️ `/auth/reset-password` has **two callers with different payloads**. The `account.js` path sends
> `oldpassword`; the forgot-password path does not. Both must work.

### 2.2 Users — `/users`

| Method | Path | Form fields | Auth | Response |
|---|---|---|---|---|
| GET | `/users/{username}` | *(query)* | — | `{code:200, packages[], namespaces[]}` — used by `dashboardActions` |
| GET | `/users/{user}` ⚠️ **raw `fetch`** | — | — | `{user:{email, createdAt}, packages[]}` — used by `userActions`. **Same route as above.** |
| POST | `/users/account` | `uuid` | — | `{user:{email, createdAt}}` |
| POST | `/users/admin` | *(empty FormData)* | `Bearer` | `{code:200, message}` |
| POST | `/users/delete` | `uuid`, `username` | — | `{code:200, message}` |

### 2.3 Packages — `/packages`

| Method | Path | Form / query | Auth | Response |
|---|---|---|---|---|
| GET | `/packages` | `query`, `page` (**0-based**), `sorted_by` (`""`\|`"updatedat"`\|`"name"`\|`"downloads"`) | — | `{packages[], total_pages}` — **no `code` check** |
| GET | `/packages/{ns}/{pkg}` | — | — | `{code:200, data:{…}}` — `namespace`, `name`, `updated_at`, `registry_description`, `repository`, `homepage`, `license`, `latest_version_data.version`, `version_history[]`, `ratings_count{}` |
| POST | `/packages/{ns}/{pkg}/verify` | `uuid` | — | raw `{isVerified}` (stored directly) |
| PUT | `/packages` ⚠️ **only PUT in the app** | `uuid`, `name`, `namespace`, `isDeprecated="true"` | — | `{code:200, message}` |
| POST | `/packages/{ns}/{pkg}/delete` | `uuid` | — | `{code:200, message}` |
| POST | `/packages/{ns}/{pkg}/{version}/delete` | `uuid` | — | `{code:200, message}` |
| POST | `/packages/{ns}/{pkg}/uploadToken` | *(empty)* | `Bearer` | `{code:200, message, uploadToken}` — 🔴 **see §7.4**: backend emits `upload_token`, frontend reads `uploadToken`. Emit **both**. |
| POST | `/packages/{ns}/{pkg}/maintainers` | `uuid` | — | `{users:[{id, username}]}` |

### 2.4 Namespaces — note singular vs plural

| Method | Path | Form fields | Auth | Response |
|---|---|---|---|---|
| GET | `/namespace/{namespace}` ⚠️ **singular** | — | — | `{packages[], createdAt}` — **no `code` check** |
| POST | `/namespace/{namespace}/delete` | `uuid` | — | `{code:200, message}` |
| POST | `/namespaces` ⚠️ **plural** | `namespace`, `namespace_description` | `Bearer` | `{code:200, message}` |
| POST | `/namespaces/{ns}/uploadToken` | `namespace` | `Bearer` | `{code:200, message, uploadToken}` |
| POST | `/namespaces/{ns}/admins` | `uuid` | — | `{users:[{id, username}]}` |
| POST | `/namespaces/{ns}/maintainers` | `uuid` | — | `{users:[{id, username}]}` |

### 2.5 Maintainership — dynamic segment at position 1 (6 routes, all `@jwt_required()`)

| Method | Path | Form fields | Auth |
|---|---|---|---|
| POST | `/{username}/maintainer` | `uuid`, `username`, `namespace`, `package` | — |
| POST | `/{username}/maintainer/remove` | `uuid`, `username`, `namespace`, `package` | — |
| POST | `/{username}/namespace/admin` | `uuid`, `username`, `namespace` | — |
| POST | `/{username}/namespace/admin/remove` | `uuid`, `username`, `namespace` | — |
| POST | `/{username}/namespace/maintainer` | `uuid`, `username`, `namespace` | — |
| POST | `/{username}/namespace/maintainer/remove` | `uuid`, `username`, `namespace`, `package` | — |

### 2.6 Ratings, reports, misc

| Method | Path | Form fields | Auth | Response |
|---|---|---|---|---|
| POST | `/ratings/{ns}/{pkg}` | `rating` (`"1"`–`"5"`, string) | `Bearer` | `{code:200, message}` |
| POST | `/report/{ns}/{pkg}` | `reason` | `Bearer` | `{code:200, message}` |
| GET | `/report/view` | — | `Bearer` | `{reports:[{namespace, package, reason}]}` |
| GET | `/registry/archives` ⚠️ **raw `fetch`** | — | — | `{archives:[string], message}` |
| GET | `/static/{archive}` | — | — | browser `<a href>` → file download |
| GET | `{ver.download_url}` | — | — | browser `<a href>` → tarball |

---

## 3. Routing hazards for the serverless rewrite

1. **`/users/{username}` and `/users/{user}` are the same route**, called with different arg names by
   two different actions. Must resolve identically.
2. **Singular `/namespace/{ns}` (GET) vs plural `/namespaces…` (POST)** — an inconsistency that must
   be preserved verbatim.
3. **`/{username}/maintainer` puts a dynamic segment at position 1.** On a static-first router these
   would shadow `/auth/*`, `/users/*`, `/packages/*`. **Match on method + segment count**, and give
   static prefixes priority.
4. **`/packages` is both GET (search) and PUT (deprecate).** Dispatch on method first.
5. `GET /packages/{ns}/{pkg}` and `GET /packages?query=` share a prefix — check for a query string
   before treating `/packages` as the package-by-name route.

---

## 4. 🔴 Known frontend auth defect that must be fixed, not preserved

`state.auth.uuid` is read in **10 components** and is **never written**:

- `authReducer.js` `initialState` = `{isAuthenticated, accessToken, refreshToken, username, isLoading, error, message}` — **no `uuid`**.
- No reducer case writes one. (`main` had `uuid: null` on `LOGOUT_SUCCESS`; `v2.0.1` removed even that key.)
- `redux-persist`'s `authTransform` whitelists only `isAuthenticated, username, accessToken, refreshToken`, so a `uuid` would not survive a reload anyway.

**On `main`** this meant `formData.append("uuid", undefined)` serialised to the literal string
`"undefined"`, and **11 endpoints received `uuid === "undefined"` with no `Authorization` header**.

**On `v2.0.1`** the new `apiClient.js:createFormData` filters out `undefined`/`null`, so the literal
string is no longer sent — it is silently *omitted*. That is an accident of the new helper, **not a
fix**. The 10 call sites and the state bug are identical.

**The real impact on `v2.0.1`:** 8 of those 10 call paths use the **unauthenticated `post()` helper**
(no `Authorization` header) — `addRemoveMaintainerActions`, `namespaceAdminsActions`,
`namespaceMaintainersActions`, `userListActions`, and 4 of the 5 `adminActions`. Every one of those
routes is `@jwt_required()`. **So they all return 401 and those admin/moderation features are
currently non-functional in the shipped app.**

**Consequences for the migration:**

1. The serverless auth resolver must accept identity from **either** the `Authorization: Bearer`
   header **or** a `uuid` form field, so both the current frontend and the fixed one work.
2. **Do not start rejecting `"undefined"`** until the frontend sends real Bearer tokens on those
   routes, or the moderator features break twice.
3. The **frontend must be fixed** to send `Authorization: Bearer` on all 10 routes. This is part of
   the frontend revamp brief — it is a functionality fix, not a cosmetic change.

---

## 5. Known frontend defects (no action needed — noted so they are not mistaken for regressions)

| Defect | Location | Effect |
|---|---|---|
| Error branches read `error.data.*` instead of `error.response.data.*` | `packageActions.js:31,33,63` | `FETCH_PACKAGE_DATA_ERROR` always yields `statuscode: undefined`, so the `404 → /404` redirect at `package.js:54` never fires. A backend 404 renders a broken page. |
| No `axios` interceptors, no refresh endpoint, no 401 handling | whole app | Access token expiry silently breaks the session until re-login. |
| `refresh_token` stored but **never used** | whole app | Dead field. |
| `accessToken`/`refreshToken` not cleared on logout | `authReducer.js:65` | Tokens linger in `localStorage`. |
| Unscoped `h1`/`h2`/`p` rules in a global stylesheet | `404.css` | Overrides headings app-wide. |
| `Malicous` / `malicous` misspelling | 4 files | Cosmetic; do not rename during a visual revamp. |

---

## 6. Contract test obligations

Before any phase can be declared complete, the Vitest suite must assert:

- [ ] Every one of the 43 endpoints returns `code: 200` + the exact documented fields on success.
- [ ] Every error path returns **non-2xx** with `{ code, message }` — matching, not merely mirroring (D14).
- [ ] `access_token` / `refresh_token` are **snake_case** on the wire.
- [ ] `createdAt` serialises as a string of ≥ 16 characters.
- [ ] `ver.is_deprecated` is a **boolean** *and* `ver.isDeprecated` is the **string** `"true"`/`"false"` (§7.3).
- [ ] `ver.download_url` starts with `/`.
- [ ] `page` is **0-based** for `/packages`, **1-based** for `/packages_cli` (an existing asymmetry).
- [ ] `sorted_by` resolves `"updatedat"` to the real `updated_at` field, and `"downloads"` to the real download counter (§7.5).
- [ ] `/namespace/{ns}` (GET) and `/namespaces` (POST) coexist without shadowing.
- [ ] `/packages` dispatches correctly for GET, POST and PUT.
- [ ] `GET /users/{username}` returns **both** the dashboard shape and the user-page shape.
- [ ] A tarball `GET` streams from R2 with `Content-Disposition: attachment`.
- [ ] Package upload-token responses carry **both** `upload_token` and `uploadToken` (§7.4).
- [x] Identity resolves from `Authorization: Bearer`. **Superseded** — this line originally read
      "**or** a `uuid` form field", and the `uuid` half was never implemented, deliberately. The
      frontend's `apiClient` request interceptor now attaches the Bearer header to every call, so
      the ten moderator paths that used to send no credential work (§4). Accepting a body field as
      identity would let any caller assert any account; `reset-password` accepts a `uuid` field
      because there it *is* a single-use token, verified by hash and kind, not an identity claim.

---

## 7. Corrections from the `v2.0.1` re-derivation

The first pass of this document was written against `main`. Re-deriving it against `v2.0.1` changed
the following. Each was verified in code, not inferred.

### 7.1 `v2.0.1` **does** have MongoDB indexes — defect D17 is closed

`mongo.py::ensure_indexes()` (called from `server.py::initialize_app()`) creates unique indexes on
`users.uuid`/`username`/`email`, a unique composite on `packages(name, namespace)`, sort indexes, and
a **weighted text index** over `packages(name, description, registry_description, keywords,
categories)`. `BASELINE_AUDIT.md` D17 ("zero indexes") described `main` and is **wrong for the
migrated base**. The serverless implementation re-creates this exact set via the `ensureIndexes`
op, then extends it.

### 7.2 CORS in `v2.0.1` is **worse** than on `main`

```python
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
```

`supports_credentials=True` with a wildcard causes Flask-CORS to **reflect the request `Origin`**
and send `Access-Control-Allow-Credentials: true`. Any website can therefore make credentialed
cross-origin calls. The Worker implementation in `src/lib/cors.ts` fails closed and drops
`Allow-Credentials` entirely — the frontend uses Bearer tokens, not cookies, so this makes the API
CSRF-immune as a side effect.

### 7.3 🔴 `ver.isDeprecated` — a live bug, and the contract must emit **both** keys

| Side | Value |
|---|---|
| Frontend `package.js:280` | `ver.isDeprecated === "true" ? "Yes" : "No"` |
| Backend `models/package.py:126` | emits `"is_deprecated": <boolean>` |

**They never match, so every version renders "Active".** The first pass of this document wrongly
recorded the backend as emitting the string `"true"`.

Fix: emit **both** — `is_deprecated` (boolean, correct) and `isDeprecated` (string, for the current
frontend). Purely additive. Also note `is_deprecated` is never set to `True` anywhere, so the field
is currently constant; Phase 7 adds the missing deprecation API.

### 7.4 🔴 Package upload-token key mismatch

| Endpoint | Emits | Frontend reads |
|---|---|---|
| `POST /namespaces/{ns}/uploadToken` | `uploadToken` ✅ | `uploadToken` ✅ |
| `POST /packages/{ns}/{pkg}/uploadToken` | `upload_token` ❌ | `uploadToken` ❌ |

The package-token dialog silently shows an empty string. Emit **both** keys on both endpoints.

Separately: the two token stores use different timestamp key names — `createdAt`/`createdBy`
(namespaces) vs `created_at`/`created_by` (packages) — and `upload()` searches **only**
`db.namespaces`, so **package-level upload tokens cannot actually authorise an upload**. Phase 4
replaces both with one `upload_tokens` collection (defect D4) with consistent keys.

### 7.5 🔴 `sorted_by` maps to fields that do not exist

`sorted_by` is whitelisted against `{name, author, createdat, updatedat, downloads}` but the actual
document fields are `updated_at` and `created_at`; `downloads` lives on
`tarballs.files.downloads_stats.total_downloads`. So **"Date last updated" and "downloads" both
silently fall back to sorting by name**. The Worker maps the public names onto the real fields:

| Public `sorted_by` | Real sort field |
|---|---|
| `""` (default), `name` | `name` |
| `updatedat`, `createdat` | `updated_at`, `created_at` (DESC) |
| `downloads` | denormalised `download_count` on the package doc, DESC |

### 7.6 Other `v2.0.1` changes affecting the contract

- **`PUT /packages` does not exist.** `deprecatePackage` PUTs to a route that returns **405**, so
  deprecation is entirely unreachable. Phase 7 adds it.
- **`POST /auth/reset-password` is a hard 500** — `auth.py:260` references `env_var` and `hashlib`,
  neither of which is imported. Both frontend reset paths are dead.
- **`GET /apidocs` 500s** — `swag_from("documentation/search_packages_cli.yaml")` points at a file
  that does not exist. Irrelevant to the Worker, which generates its own OpenAPI document.
- **Refresh tokens are unusable** — minted at login and `verify_email`, stored by the frontend, but
  there is **no `/auth/refresh` route and no `@jwt_required(refresh=True)` anywhere**. Phase 3 adds
  one.
- **`POST /packages` derives the namespace from the token** and never reads a `namespace` form field.
- **`isAdmin` is the string `"true"`**, not a boolean.
- **`GET /users/admin/transfer` is unauthenticated** and returns 501. Dropped in the Worker.
- **Upload tokens live for exactly 7 days** and are never revoked — defect D4.
- **`MAX_CONTENT_LENGTH` now exists** (`50 MB`, from `MAX_UPLOAD_SIZE_MB`), so defect D8 is
  narrowed to the `tarfile.getnames()` decompression step rather than the whole upload.