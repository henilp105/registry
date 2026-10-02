# API Contract — frozen baseline for the serverless migration

> **Status:** Frozen · **Date:** 2026-10-02 · **Source of truth:** `frontend/src/store/actions/*` (the
> actual consumer) cross-checked against `backend/**/*.py` and `backend/documentation/*.yaml`.
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
| **`uuid` field** | Sent as a **form field**, not a header. See §4 — it is currently the literal string `"undefined"`. |
| **`createdAt`** | Must serialise as a **string of ≥ 16 chars**. `namespace.js` does `.slice(4,16)`, `accountActions` does `.slice(0,16)`. A BSON `Date` serialising to `{}` will crash the UI. |
| **`ver.isDeprecated`** | Serialises as the **string** `"true"` / `"false"`, not a boolean (`package.js:190` compares to `"true"`). |
| **`ver.download_url`** | A **root-relative path beginning with `/`**, concatenated straight onto the API base URL. |

---

## 2. Endpoint inventory (38 endpoints, all `multipart/form-data` unless noted)

### 2.1 Auth — `/auth`

| Method | Path | Form fields | Auth | Response |
|---|---|---|---|---|
| POST | `/auth/login` | `user_identifier`, `password` | — | `{code:200, message, access_token, refresh_token, username}` |
| POST | `/auth/signup` | `username`, `email`, `password` | — | `{code:200, message}` |
| POST | `/auth/logout` | *(none)* | `Bearer` | `{code:200, message}` |
| POST | `/auth/forgot-password` | `email` | — | `{code:200, message}` |
| POST | `/auth/reset-password` | `password`, `uuid` | — | `{code:200, message}` |
| POST | `/auth/reset-password` ⚠️ 2nd caller | `oldpassword`, `password`, `uuid` | — | `{message}` only, **no `code` check** |
| POST | `/auth/change-email` | `newemail`, `uuid` | — | `{message}` only, **no `code` check** |
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
| GET | `/packages` | `query`, `page` (**0-based**), `sorted_by` (`""`\|`"updatedat"`) | — | `{packages[], total_pages}` — **no `code` check** |
| GET | `/packages/{ns}/{pkg}` | — | — | `{code:200, data:{…}}` — `namespace`, `name`, `updated_at`, `registry_description`, `repository`, `homepage`, `license`, `latest_version_data.version`, `version_history[]`, `ratings_count{}` |
| POST | `/packages/{ns}/{pkg}/verify` | `uuid` | — | raw `{isVerified}` (stored directly) |
| PUT | `/packages` ⚠️ **only PUT in the app** | `uuid`, `name`, `namespace`, `isDeprecated="true"` | — | `{code:200, message}` |
| POST | `/packages/{ns}/{pkg}/delete` | `uuid` | — | `{code:200, message}` |
| POST | `/packages/{ns}/{pkg}/{version}/delete` | `uuid` | — | `{code:200, message}` |
| POST | `/packages/{ns}/{pkg}/uploadToken` | *(empty)* | `Bearer` | `{code:200, message, uploadToken}` |
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

### 2.5 Maintainership — dynamic segment at position 1

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

## 4. 🔴 Known frontend bug that must be preserved (or fixed first)

`state.auth.uuid` is read in **10 components** but **never written**:

- `authReducer.js` `initialState` = `{isAuthenticated, accessToken, refreshToken, error, username, isLoading, message}` — **no `uuid`**.
- `LOGIN_SUCCESS` sets only `accessToken`, `refreshToken`, `username`.
- The sole `uuid` write is `LOGOUT_SUCCESS → uuid: null`.

⇒ `formData.append("uuid", undefined)` serialises to the **literal string `"undefined"`**, so **11
endpoints currently receive `uuid === "undefined"`** while sending **no** `Authorization` header:

`/auth/reset-password`, `/auth/change-email`, `/users/account`, `/users/delete`,
`/packages/{ns}/{pkg}/verify`, `/packages/{ns}/{pkg}/delete`, `/packages/{ns}/{pkg}/{v}/delete`,
`/packages/{ns}/{pkg}/maintainers`, `/namespace/{ns}/delete`, `/namespaces/{ns}/admins`,
`/namespaces/{ns}/maintainers`, and all six `/{username}/…` routes.

**Consequence for the migration:** the serverless auth layer must resolve identity from
**either** the `Authorization: Bearer` header **or** a `uuid` form field, and must **not** start
rejecting `"undefined"` until the frontend has been updated to send a real token on those routes.
**This is a security defect in the current system** — those routes are effectively unauthenticated
today. It is tracked as a required fix, not silently preserved.

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

- [ ] Every one of the 38 endpoints returns `code: 200` + the exact documented fields on success.
- [ ] Every error path returns **non-2xx** with `{ code, message }`.
- [ ] `access_token` / `refresh_token` are **snake_case** on the wire.
- [ ] `createdAt` serialises as a string of ≥ 16 characters.
- [ ] `ver.isDeprecated` is the string `"true"`, not a boolean.
- [ ] `ver.download_url` starts with `/`.
- [ ] `page` is **0-based**; `sorted_by` accepts only `""` and `"updatedat"`.
- [ ] `/namespace/{ns}` (GET) and `/namespaces` (POST) coexist without shadowing.
- [ ] `/packages` dispatches correctly for both GET and PUT.
- [ ] `GET /users/{username}` returns **both** the dashboard shape and the user-page shape.
- [ ] A tarball `GET` streams from R2 with `Content-Disposition: attachment`.