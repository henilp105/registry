import { describe, expect, it } from "vitest";
import {
  LIMITS,
  clientKey,
  consume,
  failOpen,
  headersFor,
  limitKindFor,
  type Counter,
} from "../src/lib/rate-limit";

/**
 * Rate limiting, pinned to the scheme `docs/api-reference.md` documents.
 *
 * Pure functions, so no Durable Object, no clock and no network — the interesting
 * failure modes here are arithmetic and ordering, and neither needs a real
 * deployment to exercise.
 */

const T0 = 1_700_000_000_000;

describe("limitKindFor", () => {
  it("routes every auth endpoint to the tightest bucket", () => {
    for (const path of ["/auth/login", "/auth/signup", "/auth/refresh", "/auth/logout",
      "/auth/forgot-password", "/auth/reset-password", "/auth/verify-email", "/auth/change-email"]) {
      expect(limitKindFor("POST", path), path).toBe("auth");
    }
  });

  it("routes publish to the upload bucket", () => {
    expect(limitKindFor("POST", "/packages")).toBe("upload");
  });

  it("does not treat other writes as uploads", () => {
    // A namespace deletion is a write but not a quota-consuming publish. Putting
    // it in the 5/hour bucket would mean five namespace deletions an hour, which
    // is not what the documented scheme says.
    expect(limitKindFor("POST", "/packages/stdlib/json-fortran/delete")).toBe("general");
    expect(limitKindFor("POST", "/namespaces")).toBe("general");
    expect(limitKindFor("PUT", "/packages")).toBe("general");
    expect(limitKindFor("DELETE", "/packages")).toBe("general");
  });

  it("routes reads to the general bucket", () => {
    expect(limitKindFor("GET", "/packages")).toBe("general");
    expect(limitKindFor("GET", "/packages/stdlib/json-fortran")).toBe("general");
    expect(limitKindFor("GET", "/health")).toBe("general");
  });

  it("does not match a path that merely starts with /auth-ish text", () => {
    expect(limitKindFor("GET", "/authors")).toBe("general");
  });
});

describe("consume: the documented budgets", () => {
  it("allows exactly the documented number of auth requests per minute", () => {
    let counter: Counter | undefined;
    let lastAllowed = 0;
    for (let i = 0; i < LIMITS.auth.limit + 5; i++) {
      const { counter: next, decision } = consume(counter, "auth", T0);
      counter = next;
      if (decision.allowed) lastAllowed = i + 1;
    }
    expect(lastAllowed).toBe(LIMITS.auth.limit);
    expect(LIMITS.auth).toEqual({ limit: 10, windowSeconds: 60 });
  });

  it("allows exactly five uploads per hour", () => {
    let counter: Counter | undefined;
    let allowed = 0;
    for (let i = 0; i < 12; i++) {
      const { counter: next, decision } = consume(counter, "upload", T0);
      counter = next;
      if (decision.allowed) allowed++;
    }
    expect(allowed).toBe(5);
    expect(LIMITS.upload).toEqual({ limit: 5, windowSeconds: 3600 });
  });

  it("allows exactly 100 general requests per minute", () => {
    let counter: Counter | undefined;
    let allowed = 0;
    for (let i = 0; i < 130; i++) {
      const { counter: next, decision } = consume(counter, "general", T0);
      counter = next;
      if (decision.allowed) allowed++;
    }
    expect(allowed).toBe(100);
  });
});

describe("consume: window behaviour", () => {
  it("counts down remaining and never goes negative", () => {
    let counter: Counter | undefined;
    const remaining: number[] = [];
    for (let i = 0; i < 13; i++) {
      const { counter: next, decision } = consume(counter, "auth", T0);
      counter = next;
      remaining.push(decision.remaining);
    }
    expect(remaining.slice(0, 3)).toEqual([9, 8, 7]);
    // Refused requests must report 0, not a negative number a client would have
    // to interpret.
    expect(Math.min(...remaining)).toBe(0);
  });

  it("starts a fresh window once the previous one has expired", () => {
    const first = consume(undefined, "auth", T0);
    expect(first.decision.allowed).toBe(true);
    expect(first.decision.remaining).toBe(9);

    // One millisecond before the window ends: still the old counter.
    const justBefore = consume(first.counter, "auth", first.counter.expiresAtMs - 1);
    expect(justBefore.decision.remaining).toBe(8);

    // At the moment it ends: back to the full budget. The comparison is strict,
    // so `expiresAtMs === nowMs` counts as expired.
    const after = consume(first.counter, "auth", first.counter.expiresAtMs);
    expect(after.decision.remaining).toBe(9);
    expect(after.counter.expiresAtMs).toBeGreaterThan(first.counter.expiresAtMs);
  });

  it("resets an upload window after an hour, not after a minute", () => {
    const first = consume(undefined, "upload", T0);
    expect(first.decision.remaining).toBe(4); // first of five

    // A minute later the hourly window is still open, so this is the second
    // request: 5 - 2 = 3 remaining, not 4.
    const afterMinute = consume(first.counter, "upload", T0 + 61_000);
    expect(afterMinute.decision.remaining).toBe(3);
    expect(afterMinute.counter.expiresAtMs).toBe(first.counter.expiresAtMs);

    // Past the hour the budget is restored.
    const afterHour = consume(first.counter, "upload", first.counter.expiresAtMs);
    expect(afterHour.decision.remaining).toBe(4);
    expect(afterHour.counter.expiresAtMs).toBeGreaterThan(first.counter.expiresAtMs);
  });

  it("reports the reset as unix seconds, as documented", () => {
    const { decision } = consume(undefined, "auth", T0);
    expect(decision.resetAt).toBe(Math.ceil((T0 + 60_000) / 1000));
    expect(decision.resetAt).toBeGreaterThan(1_600_000_000);
    expect(decision.resetAt).toBeLessThan(2_000_000_000);
  });

  it("keeps independent keys independent", () => {
    // Counters are per key; exhausting one client must not affect another.
    let a: Counter | undefined;
    for (let i = 0; i < 10; i++) a = consume(a, "auth", T0).counter;
    expect(consume(a, "auth", T0).decision.allowed).toBe(false);
    expect(consume(undefined, "auth", T0).decision.allowed).toBe(true);
  });
});

describe("headersFor", () => {
  it("emits the three documented headers in lower case", () => {
    const { decision } = consume(undefined, "general", T0);
    const headers = headersFor(decision);
    expect(Object.keys(headers).sort()).toEqual([
      "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
    ]);
    expect(headers["x-ratelimit-limit"]).toBe("100");
    expect(headers["x-ratelimit-remaining"]).toBe("99");
    expect(headers["x-ratelimit-reset"]).toMatch(/^\d{10}$/);
  });

  it("adds Retry-After only when the request was refused", () => {
    let counter: Counter | undefined;
    let refused: Record<string, string> | undefined;
    for (let i = 0; i < 11; i++) {
      const { counter: next, decision } = consume(counter, "auth", T0);
      counter = next;
      if (!decision.allowed) refused = headersFor(decision);
    }
    expect(refused?.["retry-after"]).toBeDefined();
    expect(Number(refused?.["retry-after"])).toBeGreaterThan(0);
    expect(Number(refused?.["retry-after"])).toBeLessThanOrEqual(60);
  });

  it("omits Retry-After on a successful request", () => {
    // Clients that honour Retry-After unconditionally would throttle themselves
    // on calls that succeeded.
    expect(headersFor(consume(undefined, "auth", T0).decision)["retry-after"]).toBeUndefined();
  });
});

describe("clientKey", () => {
  const request = () => new Request("https://example.test/x");

  it("prefers the authenticated identity over the address", () => {
    // Otherwise everyone behind one NAT throttles together, and one user can deny
    // service to the rest.
    expect(clientKey(request(), "user-uuid", "203.0.113.7")).toBe("u:user-uuid");
  });

  it("falls back to the Cloudflare connecting address", () => {
    expect(clientKey(request(), null, "203.0.113.7")).toBe("a:203.0.113.7");
  });

  it("reads the header when the binding is absent, as in local development", () => {
    const req = new Request("https://example.test/x", { headers: { "cf-connecting-ip": "198.51.100.4" } });
    expect(clientKey(req, null, undefined)).toBe("a:198.51.100.4");
  });

  it("degrades to a shared bucket rather than throwing", () => {
    // Failing open on identity is better than 500-ing every anonymous request.
    expect(clientKey(request(), null, undefined)).toBe("a:unknown");
  });

  it("strips a port and bounds the length", () => {
    expect(clientKey(request(), null, "203.0.113.7:443")).toBe("a:203.0.113.7");
    const long = clientKey(request(), null, "x".repeat(300));
    expect(long.length).toBeLessThanOrEqual(48);
  });

  it("distinguishes authenticated from anonymous callers", () => {
    expect(clientKey(request(), "u1", "1.2.3.4")).not.toBe(clientKey(request(), null, "1.2.3.4"));
  });
});

describe("failOpen", () => {
  it("returns the operation's value when it succeeds", async () => {
    await expect(failOpen(async () => 42, 0)).resolves.toBe(42);
  });

  it("returns the fallback when the operation throws", async () => {
    // A limiter that throws takes the API down with it. That is worse than not
    // rate limiting: the control exists to reduce availability risk.
    await expect(failOpen(async () => { throw new Error("DO unavailable"); }, -1)).resolves.toBe(-1);
  });

  it("does not swallow a non-promise", async () => {
    await expect(failOpen(() => { throw new Error("sync"); }, 7)).resolves.toBe(7);
  });
});
