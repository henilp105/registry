import { describe, expect, it } from "vitest";
import {
  signToken,
  verifyToken,
  b64urlDecode,
  b64urlEncode,
  type Claims,
} from "../src/lib/jwt";

const SECRET = "test-secret-that-is-long-enough-for-hmac";
const OTHER_SECRET = "a-completely-different-secret-value-here";
const UUID = "3f9a1c2b4d5e6f708192a3b4c5d6e7f80";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    for (const len of [0, 1, 2, 3, 16, 32, 255]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      expect([...b64urlDecode(b64urlEncode(bytes))]).toEqual([...bytes]);
    }
  });

  it("emits URL-safe output with no padding", () => {
    const bytes = new Uint8Array([251, 255, 190, 254]);
    const encoded = b64urlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...b64urlDecode(encoded)]).toEqual([...bytes]);
  });
});

describe("signToken", () => {
  it("produces a three-segment HS256 token", async () => {
    const token = await signToken(UUID, SECRET, "access");
    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0] as string)));
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
  });

  it("emits the same claim set as flask-jwt-extended", async () => {
    const token = await signToken(UUID, SECRET, "refresh");
    const claims = JSON.parse(
      new TextDecoder().decode(b64urlDecode(token.split(".")[1] as string)),
    ) as Claims;

    // These exact keys are what the legacy deployment emits, so a token
    // minted by either side validates on the other during the canary.
    expect(Object.keys(claims).sort()).toEqual(
      ["sub", "type", "fresh", "iat", "exp", "nbf", "jti"].sort(),
    );
    expect(claims.sub).toBe(UUID);
    expect(claims.type).toBe("refresh");
    expect(claims.fresh).toBe(false);
  });

  it("defaults to 90 days for access and 180 for refresh", async () => {
    const now = 1_700_000_000;
    const access = JSON.parse(
      new TextDecoder().decode(
        b64urlDecode((await signToken(UUID, SECRET, "access", { now })).split(".")[1] as string),
      ),
    ) as Claims;
    const refresh = JSON.parse(
      new TextDecoder().decode(
        b64urlDecode((await signToken(UUID, SECRET, "refresh", { now })).split(".")[1] as string),
      ),
    ) as Claims;

    expect(access.exp - access.iat).toBe(90 * 86_400);
    expect(refresh.exp - refresh.iat).toBe(180 * 86_400);
  });

  it("gives every token a distinct jti", async () => {
    const a = await signToken(UUID, SECRET, "access");
    const b = await signToken(UUID, SECRET, "access");
    expect(a).not.toBe(b);
  });
});

describe("verifyToken", () => {
  it("accepts a token it signed", async () => {
    const token = await signToken(UUID, SECRET, "access");
    const result = await verifyToken(token, SECRET, "access");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.sub).toBe(UUID);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signToken(UUID, OTHER_SECRET, "access");
    const result = await verifyToken(token, SECRET, "access");
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a tampered payload", async () => {
    const token = await signToken(UUID, SECRET, "access");
    const [h, , s] = token.split(".") as [string, string, string];
    const forged = b64urlEncode(
      new TextEncoder().encode(
        JSON.stringify({ sub: "someone-else", type: "access", iat: 1, exp: 9_999_999_999, nbf: 1, jti: "x" }),
      ),
    );
    const result = await verifyToken(`${h}.${forged}.${s}`, SECRET, "access");
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects an expired token", async () => {
    const issuedAt = 1_000_000;
    const token = await signToken(UUID, SECRET, "access", { now: issuedAt, expiresInDays: 1 });
    // Now is well past issuedAt + 1 day.
    const result = await verifyToken(token, SECRET, "access", issuedAt + 2 * 86_400);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token that is not yet valid, allowing 60s of skew", async () => {
    const issuedAt = 1_000_000;
    const token = await signToken(UUID, SECRET, "access", { now: issuedAt });

    const tooEarly = await verifyToken(token, SECRET, "access", issuedAt - 61);
    expect(tooEarly).toEqual({ ok: false, reason: "not-yet-valid" });

    const withinSkew = await verifyToken(token, SECRET, "access", issuedAt - 30);
    expect(withinSkew.ok).toBe(true);
  });

  it("rejects a refresh token where an access token is required", async () => {
    const token = await signToken(UUID, SECRET, "refresh");
    expect(await verifyToken(token, SECRET, "access")).toEqual({
      ok: false,
      reason: "wrong-type",
    });
    expect((await verifyToken(token, SECRET, "refresh")).ok).toBe(true);
  });

  it("rejects malformed input without throwing", async () => {
    for (const bad of ["", "not-a-token", "a.b", "a.b.c.d", "...", "!!.??.##"]) {
      const result = await verifyToken(bad, SECRET, "access");
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a token whose sub is missing or empty", async () => {
    const header = b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const payload = b64urlEncode(
      new TextEncoder().encode(
        JSON.stringify({ sub: "", type: "access", iat: 1, exp: 9_999_999_999, nbf: 1, jti: "x" }),
      ),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    const token = `${header}.${payload}.${b64urlEncode(sig)}`;
    expect(await verifyToken(token, SECRET, "access")).toEqual({
      ok: false,
      reason: "missing-sub",
    });
  });
});