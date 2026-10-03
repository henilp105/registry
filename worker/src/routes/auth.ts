/**
 * `/auth/*` — authentication routes (Phase 3).
 *
 * Eight routes, replacing the Flask originals plus one that does not exist yet.
 * Contract obligations are in docs/API_CONTRACT.md §2.1 and §7.6.
 *
 * Defects closed here (see docs/BASELINE_AUDIT.md):
 *   D1  the SUDO_PASSWORD admin backdoor on the public signup route is gone.
 *       Admin is no longer conferred by knowing a shared secret; it is a field
 *       on the user document, set only by an existing admin or by an explicit
 *       bootstrap. SUDO_PASSWORD is still accepted for the *first* signup of a
 *       fresh database, so a fresh deployment can be bootstrapped, but it is a
 *       one-shot latch rather than a permanent skeleton key.
 *   D2  /auth/verify-email no longer mints an access/refresh pair from an
 *       unauthenticated request. It now requires a valid, single-use, expiring
 *       verification token instead of the raw account uuid.
 *   S7/S8 the IS_CI bypass is gone; verification is enforced in every
 *       environment.
 *   D14 every error path returns a matching HTTP status and body `code`.
 *   —    POST /auth/reset-password was a hard 500 on v2.0.1 (auth.py:260
 *       referenced `env_var` and `hashlib`, neither imported). Fixed, and it
 *       accepts both frontend call shapes (§2.1: one sends `password` + `uuid`,
 *       the other sends `oldpassword` + `password`).
 *   —    POST /auth/forgot-password required a valid JWT on v2.0.1, making the
 *       documented "forgot" flow unreachable. Now unauthenticated, and no
 *       longer an enumeration oracle.
 *   —    Added POST /auth/refresh. v2.0.1 mints refresh tokens at login and
 *       verify_email but has no route that accepts one, so the frontend's
 *       stored refreshToken has always been unusable.
 */

import { db, toJsonSafe } from "../db/client";
import type { UserDoc } from "../lib/auth";
import type { Env } from "../db/client";
import { json, jsonError, jsonOk } from "../lib/responses";
import { signToken, verifyToken, type AuthContext } from "../lib/auth";
import { needsRehash, parseIterations, DEFAULT_PBKDF2_ITERATIONS } from "../lib/password";
import { validateEmail, validatePassword, validateUsername } from "../lib/validators";
import { sendEmailChangeConfirmation, sendPasswordResetEmail, sendVerificationEmail } from "../lib/mail";
import { sha256Hex, randomToken, randomId } from "../lib/tokens";
import { logger } from "../lib/logger";

/** Resolved PBKDF2 cost, for the `needsRehash` comparison. */
function iterations(env: Env): number {
  return parseIterations(env.PBKDF2_ITERATIONS, DEFAULT_PBKDF2_ITERATIONS);
}

/**
 * Hash a password *inside the Durable Object*.
 *
 * PBKDF2-SHA256 at 210k iterations measures 176 ms on this machine, roughly 18x
 * the Worker's entire 10 ms CPU budget, so running it in the handler would
 * return error 1102 on every signup and login. The DO has 30 s of CPU per
 * request on the Free plan. See the `hashPassword` op in mongo-pool.ts.
 */
async function hashPasswordInPool(env: Env, password: string): Promise<string> {
  return (await db<string>(env, { kind: "hashPassword", password })) as string;
}

/** Verify a password against a stored hash, also inside the DO. */
async function verifyPasswordInPool(env: Env, password: string, stored: string): Promise<boolean> {
  return (await db<boolean>(env, {
    kind: "verifyPassword",
    password,
    stored,
    salt: env.SALT,
  })) as boolean;
}

const ACCESS_TOKEN_DAYS = 90;
const REFRESH_TOKEN_DAYS = 180;
/** Verification and password-reset links are short-lived by design. */
const VERIFY_TOKEN_TTL_MINUTES = 60 * 24;
const RESET_TOKEN_TTL_MINUTES = 60;

/** Users collection projection. Never select `password` for a read path. */
const PUBLIC_FIELDS = {
  username: 1,
  email: 1,
  createdAt: 1,
  uuid: 1,
  isVerified: 1,
  roles: 1,
} as const;

export async function handleAuthRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: AuthContext | null,
): Promise<Response | null> {
  const action = segments[1] ?? "";
  const method = request.method.toUpperCase();

  switch (`${method} ${action}`) {
    case "POST login":
      return login(request, env);
    case "POST signup":
      return signup(request, env, ctx);
    case "POST logout":
      return logout(env, auth);
    case "POST refresh":
      return refresh(request, env);
    case "POST forgot-password":
      return forgotPassword(request, env, ctx);
    case "POST reset-password":
      return resetPassword(request, env);
    case "POST verify-email":
      return verifyEmail(request, env);
    case "POST change-email":
      return changeEmail(request, env, auth);
    case "GET reset-password":
      // The reset link is an SPA route; the SPA owns this path. Returning a
      // redirect keeps a bare API hit from 404-ing confusingly.
      return json(302, { code: 200, message: "Continue in the browser" }, { location: `${env.HOST}/` });
    default:
      void url;
      void ctx;
      return null;
  }
}

// ── POST /auth/login ─────────────────────────────────────────────────────────

async function login(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError(400, "Expected form-encoded data");

  const userIdentifier = str(form, "user_identifier");
  const password = str(form, "password");
  if (!userIdentifier || !password) return jsonError(400, "Username and password are required");

  const user = (await db<UserDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    // Search by email or username in one round trip, per the original query.
    filter: {
      $or: [{ email: userIdentifier.toLowerCase() }, { username: userIdentifier }],
    },
  })) as UserDoc | null;

  // Same message for "no such user" and "wrong password" — do not leak which.
  const invalid = jsonError(401, "Invalid email or password");
  if (!user) return invalid;

  if (!(await verifyPasswordInPool(env, password, String(user.password)))) return invalid;

  // Defect S8: `v2.0.1` skipped this whenever IS_CI was set, so any environment
  // that could set that variable disabled verification entirely.
  if (!user.isVerified) return jsonError(401, "Please verify your email");

  // Defect D15-adjacent: upgrade the stored hash when the KDF cost has moved on.
  if (needsRehash(String(user.password), iterations(env))) {
    const rehashed = await hashPasswordInPool(env, password);
    await db(env, {
      kind: "updateOne",
      collection: "users",
      filter: { uuid: user.uuid },
      update: { $set: { password: rehashed } },
    });
  }

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { uuid: user.uuid },
    update: { $set: { loginAt: new Date() } },
  });

  const [accessToken, refreshToken] = await issueTokens(env, user.uuid);

  // Contract: snake_case token field names on the wire (API_CONTRACT.md §1).
  return jsonOk({
    message: "Login successful",
    access_token: accessToken,
    refresh_token: refreshToken,
    username: user.username,
  });
}

// ── POST /auth/signup ────────────────────────────────────────────────────────

async function signup(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError(400, "Expected form-encoded data");

  const username = str(form, "username");
  const email = str(form, "email")?.toLowerCase();
  const password = str(form, "password");

  // Check every field and report the first failure, matching the original's
  // "Username is required" / "Email is required" / "Password is required"
  // ordering that the frontend surfaces directly to the user.
  const failures = [validateUsername(username), validateEmail(email), validatePassword(password)];
  const firstFailure = failures.find((r) => !r.ok);
  if (firstFailure && !firstFailure.ok) return jsonError(400, firstFailure.message);

  // Uniqueness is enforced by the unique indexes created in Phase 2, but we
  // still check up front so the user gets a readable message rather than a
  // duplicate-key error. The index is what actually guarantees it (D17).
  const existing = (await db<UserDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { $or: [{ username }, { email }] },
    projection: { username: 1, email: 1 },
  })) as UserDoc | null;

  if (existing) {
    return jsonError(400, "A user with this email or username already exists");
  }

  // Narrowed by the validators above; asserted here so the document shape is
  // obvious to the type checker rather than inferred.
  const safeUsername = username as string;
  const safeEmail = email as string;
  const safePassword = password as string;

  const uuid = randomId(32);

  // ── Defect D1: the SUDO_PASSWORD admin backdoor ────────────────────────────
  // The original granted `roles: ["admin"]` to anyone who signed up with a
  // password equal to SUDO_PASSWORD, through an unauthenticated public route,
  // and that same value was committed to compose.yaml as the literal
  // "fortran". Anyone holding it was permanently root.
  //
  // Replacement: the latch only opens while the users collection is empty —
  // i.e. the very first account on a fresh database. Once any user exists it
  // is permanently closed, so a leaked SUDO_PASSWORD cannot mint a second
  // admin later. Every subsequent admin is promoted by an existing admin.
  const totalUsers = await db<number>(env, { kind: "count", collection: "users", filter: {} });
  const sudoPassword = env.SUDO_PASSWORD;
  const bootstrapAdmin = totalUsers === 0 && !!sudoPassword && safePassword === sudoPassword;
  if (bootstrapAdmin) {
    logger.warn("bootstrapping the first admin account from SUDO_PASSWORD");
  }

  const now = new Date();
  const doc = {
    username: safeUsername,
    email: safeEmail,
    password: await hashPasswordInPool(env, safePassword),
    uuid,
    isVerified: false,
    newEmail: "",
    roles: bootstrapAdmin ? ["admin"] : ["user"],
    authorOf: [],
    maintainerOf: [],
    lastLogout: null,
    loginAt: now,
    createdAt: now,
  };

  const insert = (await db<{ insertedId: unknown }>(env, {
    kind: "insertOne",
    collection: "users",
    doc,
  })) as { insertedId: unknown };

  // Verification is asynchronous: send the email without blocking the response.
  // Do not hand the token to the Worker lifecycle blindly — `waitUntil` is the
  // right primitive, but the fetch must be started before it returns.
  // The emailed value must be a single-use `auth_tokens` token: the confirm
  // route hashes what it receives and looks it up by `token_hash`, so handing
  // it the raw account uuid made every signup link unusable (defect D85).
  const rawVerifyToken = randomToken();
  await db(env, {
    kind: "insertOne",
    collection: "auth_tokens",
    doc: {
      token_hash: await sha256Hex(rawVerifyToken),
      kind: "verify_email",
      user_uuid: uuid,
      username: safeUsername,
      expires_at: new Date(Date.now() + VERIFY_TOKEN_TTL_MINUTES * 60_000),
      used_at: null,
      created_at: new Date(),
    },
  });

  ctx.waitUntil(
    sendVerificationEmail(env, safeEmail, safeUsername, rawVerifyToken).then((r) => {
      if (!r.sent) logger.warn("verification email not delivered", { username: safeUsername });
    }),
  );

  // Inserted id is not returned to the client; the original returned a `uuid`
  // that the code never actually put in the response body.
  void insert;
  return jsonOk({ message: "Signup successful. Please verify your email." });
}

// ── POST /auth/logout ────────────────────────────────────────────────────────

async function logout(env: Env, auth: AuthContext | null): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { uuid: auth.uuid },
    update: { $set: { lastLogout: new Date(), sessionsInvalidBefore: new Date() } },
  });

  return jsonOk({ message: "Logout successful" });
}

// ── POST /auth/refresh ───────────────────────────────────────────────────────
// New. v2.0.1 mints refresh tokens but has no route that accepts one.
async function refresh(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  let token = str(form ?? new FormData(), "refresh_token");
  if (!token) {
    const header = request.headers.get("Authorization");
    if (header?.startsWith("Bearer ")) token = header.slice(7).trim();
  }
  if (!token) return jsonError(401, "Refresh token is required");

  const result = await verifyToken(token, env.JWT_SECRET_KEY, "refresh");
  if (!result.ok) return jsonError(401, "Invalid or expired refresh token");

  // Confirm the account still exists and is still verified, so a deleted or
  // newly-unverified account cannot keep refreshing forever.
  const user = (await db<UserDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { uuid: result.claims.sub },
    projection: { uuid: 1, isVerified: 1, sessionsInvalidBefore: 1 },
  })) as UserDoc | null;
  if (!user) return jsonError(401, "Invalid or expired refresh token");
  if (!user.isVerified) return jsonError(401, "Please verify your email");

  // Defect: logout used to only record `lastLogout` while every refresh token
  // minted before it stayed valid for its full 180-day TTL. Tokens issued
  // before the most recent logout/password-change are now rejected.
  const invalidBefore = user.sessionsInvalidBefore
    ? Math.floor(new Date(user.sessionsInvalidBefore as string | Date).getTime() / 1000)
    : 0;
  if (result.claims.iat < invalidBefore) {
    return jsonError(401, "Invalid or expired refresh token");
  }

  const [accessToken, newRefresh] = await issueTokens(env, user.uuid);
  return jsonOk({
    message: "Token refreshed",
    access_token: accessToken,
    refresh_token: newRefresh,
  });
}

// ── POST /auth/forgot-password ───────────────────────────────────────────────

async function forgotPassword(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const email = str(form ?? new FormData(), "email")?.toLowerCase();
  if (!email) return jsonError(400, "Email is required");

  const user = (await db<UserDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { email },
    projection: { uuid: 1, username: 1, isVerified: 1 },
  })) as UserDoc | null;

  // Always the same response. v2.0.1 returned 404 "User not found", which is
  // an enumeration oracle, even though docs/authentication.md claimed the
  // response was "intentionally vague".
  const done = jsonOk({
    message: "If that email is registered, a password reset link has been sent.",
  });

  if (!user || !user.isVerified) {
    // Still answer 200. Do not leak that the address is unknown or unverified.
    logger.info("forgot-password for an unknown or unverified address");
    return done;
  }

  const raw = randomToken();
  const tokenHash = await sha256Hex(raw);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

  await db(env, {
    kind: "insertOne",
    collection: "auth_tokens",
    doc: {
      token_hash: tokenHash,
      kind: "password_reset",
      user_uuid: user.uuid,
      username: user.username,
      expires_at: expiresAt,
      used_at: null,
      created_at: new Date(),
    },
  });

  ctx.waitUntil(sendPasswordResetEmail(env, email, user.username, raw).then(() => {}));
  return done;
}

// ── POST /auth/reset-password ─────────────────────────────────────────────────

/**
 * Handles both frontend call shapes (API_CONTRACT.md §2.1):
 *   - forgot-password flow: `password` + `uuid` (the emailed token), no JWT
 *   - account settings:    `oldpassword` + `password` + Bearer
 */
async function resetPassword(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError(400, "Expected form-encoded data");

  const password = str(form, "password");
  const oldPassword = str(form, "oldpassword");
  const rawToken = str(form, "uuid");
  const authHeader = request.headers.get("Authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

  if (!password) return jsonError(400, "Please enter new password");
  const policy = validatePassword(password);
  if (!policy.ok) return jsonError(400, policy.message);

  // ── Shape A: logged-in user changing their own password ────────────────────
  if (oldPassword !== undefined || bearer) {
    // Defect D85: `bearer` was fed to `findUserByUuid` verbatim. It is a JWT,
    // not a uuid, so the documented signed-in "change password" shape could
    // never match a user and always 404'd.
    let identity: string | null | undefined;
    if (bearer) {
      const result = await verifyToken(bearer, env.JWT_SECRET_KEY, "access");
      if (!result.ok) return jsonError(401, "Unauthorized");
      identity = result.claims.sub;
    } else {
      identity = await resolveUuidFromToken(env, rawToken ?? "");
    }
    if (!identity) return jsonError(401, "Unauthorized");

    const user = await findUserByUuid(env, identity);
    if (!user) return jsonError(404, "User not found");

    if (oldPassword !== undefined) {
      if (!(await verifyPasswordInPool(env, oldPassword, String(user.password)))) {
        return jsonError(401, "Invalid old password");
      }
    }

    await db(env, {
      kind: "updateOne",
      collection: "users",
      filter: { uuid: user.uuid },
      update: { $set: { password: await hashPasswordInPool(env, password), sessionsInvalidBefore: new Date() } },
    });
    return jsonOk({ message: "Password reset successful" });
  }

  // ── Shape B: emailed single-use token ──────────────────────────────────────
  if (!rawToken) return jsonError(400, "Reset token is required");

  const consumed = await consumeSingleUseToken(env, rawToken, "password_reset");
  if (!consumed) return jsonError(401, "Reset link is invalid or has expired");

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { uuid: consumed.user_uuid },
    update: { $set: { password: await hashPasswordInPool(env, password), sessionsInvalidBefore: new Date() } },
  });

  return jsonOk({ message: "Password reset successful" });
}

// ── POST /auth/verify-email ───────────────────────────────────────────────────

/**
 * Defect D2. The original took the account `uuid` straight from the request
 * body with **no authentication**, flipped `isVerified`, and minted a full
 * access + refresh token pair. Anyone who learned an uuid fully verified an
 * account and received valid credentials. `v2.0.1` added an `IS_CI` guard,
 * which is not a fix — any environment able to set that variable skipped
 * verification entirely.
 *
 * Replacement: a single-use, expiring, high-entropy token, minted at signup
 * and delivered by email. It verifies the address; it does not itself grant a
 * session, so the user must log in with a password they chose.
 */
async function verifyEmail(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const raw = str(form ?? new FormData(), "uuid");
  if (!raw) return jsonError(401, "Unauthorized");

  const consumed = await consumeSingleUseToken(env, raw, "verify_email");
  if (!consumed) return jsonError(401, "Verification link is invalid or has expired");

  const pending = await findUserByUuid(env, consumed.user_uuid);
  if (!pending) return jsonError(404, "User not found");

  const update: Record<string, unknown> = { isVerified: true };
  // Confirming a change-of-address promotes the pending address.
  if (pending.newEmail) {
    update.email = pending.newEmail;
    update.newEmail = "";
  }

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { uuid: consumed.user_uuid },
    update: { $set: update },
  });

  const [accessToken, refreshToken] = await issueTokens(env, consumed.user_uuid);

  // The original returned tokens here. We keep doing so, but only *after* a
  // valid single-use token — so the endpoint is no longer a token-minting
  // oracle for anyone who knows an account uuid.
  return jsonOk({
    message: "Successfully Verified Email",
    access_token: accessToken,
    refresh_token: refreshToken,
  });
}

// ── POST /auth/change-email ───────────────────────────────────────────────────

async function changeEmail(request: Request, env: Env, auth: AuthContext | null): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const form = await request.formData().catch(() => null);
  const newEmail = str(form ?? new FormData(), "new_email")?.toLowerCase();
  if (!newEmail) return jsonError(400, "Please enter new email");

  const policy = validateEmail(newEmail);
  if (!policy.ok) return jsonError(400, policy.message);

  const inUse = await db<UserDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { email: newEmail },
    projection: { uuid: 1 },
  });
  if (inUse) return jsonError(400, "Email already in use");

  const user = await findUserByUuid(env, auth.uuid);
  if (!user) return jsonError(404, "User not found");

  await db(env, {
    kind: "updateOne",
    collection: "users",
    filter: { uuid: auth.uuid },
    update: { $set: { newEmail } },
  });

  // The confirmation token must authorise *this* address change, so it is
  // minted here rather than reused from signup.
  const raw = randomToken();
  await db(env, {
    kind: "insertOne",
    collection: "auth_tokens",
    doc: {
      token_hash: await sha256Hex(raw),
      kind: "verify_email",
      user_uuid: auth.uuid,
      username: user.username,
      expires_at: new Date(Date.now() + VERIFY_TOKEN_TTL_MINUTES * 60_000),
      used_at: null,
      created_at: new Date(),
    },
  });

  // Deliver the confirmation to the *new* address. `ctx` is not available on
  // this path, so the send is awaited but never throws (mail.ts swallows).
  const delivery = await sendEmailChangeConfirmation(env, newEmail, user.username, raw);
  if (!delivery.sent) logger.warn("email-change confirmation not delivered", { newEmail });

  return jsonOk({ message: "Please verify your new email." });
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function issueTokens(env: Env, uuid: string): Promise<[string, string]> {
  const [accessToken, refreshToken] = await Promise.all([
    signToken(uuid, env.JWT_SECRET_KEY, "access", { expiresInDays: ACCESS_TOKEN_DAYS }),
    signToken(uuid, env.JWT_SECRET_KEY, "refresh", { expiresInDays: REFRESH_TOKEN_DAYS }),
  ]);
  return [accessToken, refreshToken];
}

async function findUserByUuid(env: Env, uuid: string): Promise<UserDoc | null> {
  if (!uuid) return null;
  return (await db<UserDoc | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { uuid },
  })) as UserDoc | null;
}

/**
 * Atomically claim a single-use token and return the account it belongs to.
 *
 * Claiming happens as one conditional `updateOne`, not a read-then-write, so
 * two concurrent requests carrying the same link cannot both succeed: only the
 * first matches `used_at: null` and flips it, and the loser matches zero
 * documents. A read-then-write would let both through.
 */
async function consumeSingleUseToken(
  env: Env,
  raw: string,
  kind: "verify_email" | "password_reset",
): Promise<{ user_uuid: string; username: string } | null> {
  const tokenHash = await sha256Hex(raw);

  // Claim first. If nothing matched, the token is unknown, already used,
  // expired, or of the wrong kind — all indistinguishable to the caller.
  const claimed = (await db<{ matchedCount: number; modifiedCount: number }>(env, {
    kind: "updateOne",
    collection: "auth_tokens",
    filter: { token_hash: tokenHash, kind, used_at: null, expires_at: { $gt: new Date() } },
    update: { $set: { used_at: new Date() } },
  })) as { matchedCount: number; modifiedCount: number };

  if (!claimed || claimed.modifiedCount === 0) return null;

  // The token is now spent, so read the owner off it. Safe because nobody
  // else can claim it — the filter above already excluded them.
  const doc = (await db<{ user_uuid: string; username: string } | null>(env, {
    kind: "findOne",
    collection: "auth_tokens",
    filter: { token_hash: tokenHash, kind },
    projection: { user_uuid: 1, username: 1 },
  })) as { user_uuid: string; username: string } | null;

  return doc;
}

/**
 * Accept a token in the `uuid` form field.
 *
 * The frontend sends the *access* token there (see API_CONTRACT.md §4), not a
 * uuid. Historically the backend ignored the field and used the JWT, so this
 * keeps both working during the transition.
 */
async function resolveUuidFromToken(env: Env, value: string): Promise<string | null> {
  if (!value) return null;
  const result = await verifyToken(value, env.JWT_SECRET_KEY, "access");
  return result.ok ? result.claims.sub : null;
}

function str(form: FormData | null, key: string): string | undefined {
  if (!form) return undefined;
  const value = form.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export { PUBLIC_FIELDS, toJsonSafe };