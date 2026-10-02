import { describe, expect, it } from "vitest";
import {
  hashPassword,
  needsRehash,
  parseHash,
  parseIterations,
  verifyPassword,
  sha256Hex,
  DEFAULT_PBKDF2_ITERATIONS,
} from "../src/lib/password";

const SALT = "MYSALT";

describe("hashPassword", () => {
  it("produces the documented pbkdf2 format", async () => {
    const hash = await hashPassword("correct horse battery staple", 10_000);
    expect(hash).toMatch(/^pbkdf2\$sha256\$10000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it("uses a per-password salt, so identical passwords differ", async () => {
    const a = await hashPassword("same-password", 10_000);
    const b = await hashPassword("same-password", 10_000);
    // Defect S4: sha256(password + static SALT) produced identical hashes for
    // every user with the same password, which is what made the table
    // rainbow-tableable. This must never happen again.
    expect(a).not.toBe(b);
    expect(parseHash(a)?.salt).not.toBe(parseHash(b)?.salt);
  });

  it("records the iteration count so the cost can be raised later", async () => {
    const hash = await hashPassword("pw", 12_345);
    expect(parseHash(hash)?.iterations).toBe(12_345);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("s3cret-passphrase", 10_000);
    expect(await verifyPassword("s3cret-passphrase", hash, SALT)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-passphrase", 10_000);
    expect(await verifyPassword("s3cret-passphraseX", hash, SALT)).toBe(false);
    expect(await verifyPassword("", hash, SALT)).toBe(false);
  });

  it("still verifies legacy sha256(password + SALT) so nobody is locked out", async () => {
    // Reproduces exactly what `main` stored: hashlib.sha256((pw + SALT).encode()).hexdigest()
    const legacyDigest = await sha256Hex("legacypassword" + SALT);
    const stored = `legacy-sha256$${legacyDigest}`;

    expect(await verifyPassword("legacypassword", stored, SALT)).toBe(true);
    expect(await verifyPassword("wrongpassword", stored, SALT)).toBe(false);
  });

  it("fails closed on bcrypt rather than accepting it silently", async () => {
    // bcryptjs costs 50-100 ms of CPU, which alone exceeds the 10 ms Worker
    // Free limit. The target database has no bcrypt hashes, so this path must
    // reject rather than pretend to verify.
    const bcryptish = "$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU";
    expect(await verifyPassword("anything", bcryptish, SALT)).toBe(false);
  });

  it("rejects malformed and unknown hash formats", async () => {
    for (const bad of ["", "not-a-hash", "pbkdf2$sha256$abc$x$y", "pbkdf2$sha256$10000$onlysalt"]) {
      expect(await verifyPassword("pw", bad, SALT)).toBe(false);
    }
  });
});

describe("needsRehash", () => {
  it("flags legacy hashes for upgrade", async () => {
    const legacy = `legacy-sha256$${await sha256Hex("pw" + SALT)}`;
    expect(needsRehash(legacy, DEFAULT_PBKDF2_ITERATIONS)).toBe(true);
  });

  it("flags a pbkdf2 hash below the configured cost", async () => {
    const weak = await hashPassword("pw", 1000);
    expect(needsRehash(weak, DEFAULT_PBKDF2_ITERATIONS)).toBe(true);
  });

  it("leaves a current hash alone", async () => {
    const current = await hashPassword("pw", DEFAULT_PBKDF2_ITERATIONS);
    expect(needsRehash(current, DEFAULT_PBKDF2_ITERATIONS)).toBe(false);
  });

  it("does not throw on an unparseable value", () => {
    expect(needsRehash("garbage", DEFAULT_PBKDF2_ITERATIONS)).toBe(false);
  });
});

describe("parseIterations", () => {
  it("accepts a sane configured value", () => {
    expect(parseIterations("600000")).toBe(600_000);
  });

  it("falls back when the value is absent, nonsense, or absurdly low", () => {
    expect(parseIterations(undefined)).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(parseIterations("not-a-number")).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(parseIterations("0")).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(parseIterations("12")).toBe(DEFAULT_PBKDF2_ITERATIONS);
  });
});

/**
 * Why this file's KDF is invoked from a Durable Object, not a Worker.
 *
 * Measured on this machine (median of 5, native WebCrypto):
 *
 *     PBKDF2-SHA256    4,096 iterations .....   3.9 ms
 *     PBKDF2-SHA256   10,000 iterations .....   8.5 ms
 *     PBKDF2-SHA256  210,000 iterations ..... 176   ms
 *
 *     Cloudflare Workers Free budget ........  10   ms
 *
 * So the iteration count MongoDB itself uses for SCRAM already costs ~40% of
 * the whole Worker budget, and the count we want for password storage is ~18x
 * over it. Hashing inside a request handler would return Cloudflare error 1102
 * on every signup and every login. The Durable Object gets 30 s of CPU per
 * request on the Free plan, which is where the KDF now runs — see the
 * `hashPassword` / `verifyPassword` ops in src/db/mongo-pool.ts.
 *
 * There is deliberately **no** wall-clock assertion here. The number above
 * swings by an order of magnitude with machine load (measured 176 ms idle
 * versus 1793 ms under contention), so a timing test would be flaky and would
 * tell us nothing about workerd. The load-bearing guarantee is structural —
 * that no Worker handler calls the KDF directly — and that is asserted below.
 */
describe("KDF placement", () => {
  it("does not import the KDF functions into any Worker handler", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const routesDir = new URL("../src/routes/", import.meta.url).pathname;

    const offenders: string[] = [];
    for (const file of readdirSync(routesDir)) {
      if (!file.endsWith(".ts")) continue;
      const raw = readFileSync(join(routesDir, file), "utf8");

      // Strip comments first. These files discuss PBKDF2 at length in prose,
      // and a naive substring scan matches its own documentation.
      const source = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
        .replace(/\/\/.*$/gm, "");

      // The invariant is about *importing* the KDF, not about mentioning the
      // name: routes/auth.ts defines thin local wrappers with those same names
      // that delegate to the Durable Object, which is exactly what we want.
      // Importing the real bindings would mean running the KDF in a handler.
      const passwordImport = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"\.\.\/lib\/password"/.exec(source);
      const imported = passwordImport?.[1] ?? "";
      const importsKdf = /(^|[,\s])(hashPassword|verifyPassword)(?=[,\s}])/.test(imported);

      // Also catch a route that bypasses the helper and calls WebCrypto itself.
      const callsDeriveBits = /deriveBits\s*\(|subtle\s*\.\s*deriveBits|PBKDF2["']/.test(source);

      if (importsKdf || callsDeriveBits) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("routes the KDF through a Durable Object in auth.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../src/routes/auth.ts", import.meta.url).pathname, "utf8");
    expect(source).toContain('kind: "hashPassword"');
    expect(source).toContain('kind: "verifyPassword"');
  });

  it("exposes hashPassword and verifyPassword as Durable Object ops", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../src/db/mongo-pool.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(source).toContain('kind: "hashPassword"');
    expect(source).toContain('kind: "verifyPassword"');
    // The DO owns the legacy salt, so it never has to exist in Worker env.
    expect(source).toMatch(/SALT: string/);
  });
});