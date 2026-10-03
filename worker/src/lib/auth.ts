/**
 * Request authentication — identity resolution only.
 *
 * The cryptography lives in two dependency-free modules so it can be unit
 * tested without a Worker runtime:
 *   - `jwt.ts`      HS256 sign/verify, byte-compatible with flask-jwt-extended
 *   - `password.ts` PBKDF2 hashing + legacy verification
 *
 * This module is the thin layer that turns a `Request` into an identity.
 */

import { db, type Env } from "../db/client";
import { verifyToken, type AuthContext } from "./jwt";
import type { Claims, TokenType } from "./jwt";

export type { AuthContext, Claims, TokenType };

/** The subset of a user document the auth layer reads. */
export type UserDoc = {
  _id?: unknown;
  uuid: string;
  username: string;
  email: string;
  password: string;
  isVerified: boolean;
  newEmail?: string;
  roles: string[];
  [k: string]: unknown;
};
export { signToken, verifyToken } from "./jwt";

/**
 * Resolve the caller from the `Authorization: Bearer` header.
 *
 * Returns `null` rather than throwing so anonymous routes stay reachable and
 * each handler decides how to respond. This is deliberate: the API has many
 * legitimately public read routes, and the routes that do need identity check
 * `auth === null` themselves.
 */
export async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const result = await verifyToken(token, env.JWT_SECRET_KEY, "access");
  if (!result.ok) return null;

  // Defect: logout, password change, and password reset all record
  // `sessionsInvalidBefore` on the user, but only /auth/refresh honoured it —
  // so a stolen access token stayed valid for its full TTL (up to 90 days)
  // even after the victim "logged out". Check it here, at the chokepoint every
  // authenticated route passes through. One extra indexed `users` read per
  // request; it does not touch the KDF, so it stays well inside the 10 ms
  // CPU ceiling (the I/O wait does not count against it).
  const user = (await db<{ isVerified?: boolean; sessionsInvalidBefore?: string | Date } | null>(env, {
    kind: "findOne",
    collection: "users",
    filter: { uuid: result.claims.sub },
    projection: { isVerified: 1, sessionsInvalidBefore: 1 },
  })) as { isVerified?: boolean; sessionsInvalidBefore?: string | Date } | null;
  if (!user) return null;

  const invalidBefore = user.sessionsInvalidBefore
    ? Math.floor(new Date(user.sessionsInvalidBefore).getTime() / 1000)
    : 0;
  if (result.claims.iat < invalidBefore) return null;

  return { uuid: result.claims.sub, token, claims: result.claims };
}