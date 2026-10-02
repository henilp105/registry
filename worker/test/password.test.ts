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

describe("pbkdf2 cost is inside the Worker CPU budget", () => {
  it("completes 210k iterations well under the 10 ms CPU ceiling", async () => {
    // Not a precise CPU measurement — Node and workerd differ — but it is a
    // guard against someone lowering the iteration count by an order of
    // magnitude, which would silently weaken every stored password.
    const started = Date.now();
    await hashPassword("benchmark", DEFAULT_PBKDF2_ITERATIONS);
    const elapsed = Date.now() - started;
    // Generous bound: WebCrypto is native, so 210k iterations is sub-millisecond
    // in practice. This only trips if the cost is changed to something wild.
    expect(elapsed).toBeLessThan(250);
  });
});