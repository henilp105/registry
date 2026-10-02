import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import stripJsonComments from "strip-json-comments";

/**
 * Configuration assertions over `wrangler.jsonc`.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Every defect checked here passed `npm run typecheck`, `npm run lint`, the whole
 * Vitest suite, the Python validator suite, `wrangler deploy --dry-run`, and the
 * frontend production build. None of them execute the deploy that
 * `DEPLOYMENT.md` tells an operator to run.
 *
 * They surfaced only by running `wrangler dev` and `wrangler deploy --dry-run
 * --env production` and reading the output. Specifically:
 *
 *   - `vars`, `durable_objects` and `kv_namespaces` are **not inherited** by an
 *     `env` block. The `staging` and `production` blocks each overrode only
 *     `vars` and `r2_buckets`, so `wrangler deploy --env production` produced a
 *     Worker with no `MONGO_POOL` and no `CACHE` — silently, with no error. Every
 *     route touching MongoDB would have failed in production while the same code
 *     passed everything else.
 *   - `PBKDF2_ITERATIONS` was top-level only, so staging and production would
 *     have fallen back to a default the KDF does not use.
 *   - The file declared `migrations` and `exports` at once, which Wrangler
 *     rejects as mutually exclusive — a hard config error on deploy.
 *
 * The lesson is not "add more tests", it is that **config drift lives outside
 * every other gate**. So the assertions are here, against the real file.
 */

const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

/**
 * Parse the JSONC config.
 *
 * Uses the `strip-json-comments` already in the dependency tree rather than a
 * hand-rolled regex. The hand-rolled version I wrote first only stripped lines
 * that were *entirely* comments, so it choked on the cron array:
 *
 *     "17 * * * *",   // hourly
 *
 * which is a comment trailing real content. A config parser that only works on
 * tidy input is a liability sitting in a test that exists to catch deploy
 * failures.
 */
function parseJsonc(source: string): Record<string, any> {
  return JSON.parse(stripJsonComments(source).replace(/,(\s*[}\]])/g, "$1"));
}

const config = parseJsonc(raw);
const environments = Object.keys(config.env ?? {});

describe("top-level bindings", () => {
  it("binds the Durable Object that owns the MongoDB connection", () => {
    const binding = config.durable_objects?.bindings?.find((b: any) => b.name === "MONGO_POOL");
    expect(binding, "MONGO_POOL is missing from durable_objects.bindings").toBeDefined();
    expect(binding.class_name).toBe("MongoPool");
  });

  it("declares the Durable Object's lifecycle via exports", () => {
    // Wrangler rejects `migrations` and `exports` together. This file uses
    // `exports`, so `migrations` must stay absent.
    expect(config.migrations, "`migrations` and `exports` are mutually exclusive").toBeUndefined();
    expect(config.exports?.MongoPool?.type).toBe("durable-object");
    expect(config.exports?.MongoPool?.storage).toBe("sqlite");
  });

  it("binds R2 and KV at the top level", () => {
    expect(config.r2_buckets?.some((b: any) => b.binding === "TARBALLS")).toBe(true);
    expect(config.kv_namespaces?.some((b: any) => b.binding === "CACHE")).toBe(true);
  });
});

describe("environment inheritance", () => {
  it("has at least one environment", () => {
    expect(environments.length).toBeGreaterThan(0);
  });

  it.each(environments)("%s re-declares durable_objects, which are not inherited", (env) => {
    const bindings = config.env[env].durable_objects?.bindings ?? [];
    expect(
      bindings.some((b: any) => b.name === "MONGO_POOL"),
      `env.${env} does not bind MONGO_POOL. Wrangler does not inherit durable_objects, ` +
        `so deploying this environment yields a Worker whose every database route fails.`,
    ).toBe(true);
  });

  it.each(environments)("%s re-declares kv_namespaces, which are not inherited", (env) => {
    const namespaces = config.env[env].kv_namespaces ?? [];
    expect(
      namespaces.some((b: any) => b.binding === "CACHE"),
      `env.${env} does not bind CACHE. kv_namespaces are not inherited by environments.`,
    ).toBe(true);
  });

  it.each(environments)("%s declares every top-level var, which are not inherited", (env) => {
    // `vars` is likewise not inherited. A missing one is silently defaulted by the
    // code, which is worse than an absent binding because it still "works".
    const topLevel = Object.keys(config.vars ?? {});
    const envVars = config.env[env].vars ?? {};
    const missing = topLevel.filter((k) => !(k in envVars));
    expect(
      missing,
      `env.${env} is missing var(s) ${missing.join(", ")}; vars are not inherited`,
    ).toEqual([]);
  });

  it.each(environments)("%s does not reuse another environment's KV namespace id", (env) => {
    // A copy-paste slip here is invisible in review: both environments look
    // configured, and one silently shares the other's cache-invalidation tokens.
    const ids = Object.entries(config.env)
      .filter(([name]) => name !== env)
      .map(([, cfg]: [string, any]) => cfg.kv_namespaces?.find((b: any) => b.binding === "CACHE")?.id)
      .filter(Boolean);

    const mine = config.env[env].kv_namespaces?.find((b: any) => b.binding === "CACHE")?.id;
    if (!mine || !mine.startsWith("REPLACE_WITH")) return; // placeholders differ by design

    for (const other of ids) {
      expect(mine, `env.${env} shares a KV namespace id with another environment`).not.toBe(other);
    }
  });
});

describe("deploy-time placeholders", () => {
  it("leaves KV namespace ids as explicit placeholders, never a plausible-looking value", () => {
    // These must be substituted before a real deploy, and they should be obvious
    // enough that nobody mistakes one for a real id.
    const raw2 = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const ids = [...raw2.matchAll(/"id":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id, `KV id "${id}" is not an obvious placeholder`).toMatch(/^REPLACE_WITH_/);
    }
  });

  it("names each placeholder after its environment", () => {
    for (const env of environments) {
      const id = config.env[env].kv_namespaces?.find((b: any) => b.binding === "CACHE")?.id ?? "";
      if (!id.startsWith("REPLACE_WITH")) continue;
      expect(id.toUpperCase(), `env.${env} KV placeholder should name its environment`).toContain(
        env.toUpperCase(),
      );
    }
  });
});

describe("free-tier budget", () => {
  it("uses at most 5 cron triggers, the free-plan limit", () => {
    expect((config.triggers?.crons ?? []).length).toBeLessThanOrEqual(5);
  });

  it("sets an explicit CPU ceiling, which bounds error 1102 blast radius", () => {
    expect(config.limits?.cpu_ms).toBe(10);
  });
});