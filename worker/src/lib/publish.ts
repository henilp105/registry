/**
 * Invariants of the publish path, kept free of runtime dependencies.
 *
 * This module deliberately imports nothing from `cloudflare:workers` and nothing
 * from the Durable Object, so its behaviour is unit-testable. The first attempt at
 * `upload-invariants.test.ts` imported these from `routes/packages.ts` and failed
 * to collect at all, because that module reaches `db/mongo-pool.ts` and therefore
 * `cloudflare:workers`, which does not resolve under Vitest.
 *
 * Both helpers here exist because concurrency testing against the live cluster
 * found the behaviour they guarantee to be wrong.
 */

/**
 * The filter that appends a version to a package, refusing a version already there.
 *
 * **Defect D60.** A bare `$push` is atomic but *not idempotent*, so eight
 * concurrent publishes of 1.0.0 inserted eight identical entries into `versions`.
 * Six survived, and `version_history` then reported the same version repeatedly.
 *
 * Putting the guard in the filter rather than checking first keeps the operation
 * atomic: exactly one request matches and pushes, the rest match zero documents
 * and are told the version already exists. A read-then-write would reintroduce
 * the race this avoids.
 */
export function versionAppendFilter(packageId: unknown, version: string): Record<string, unknown> {
  return { _id: packageId, "versions.version": { $ne: version } };
}

/**
 * Is this a MongoDB duplicate-key error?
 *
 * **Defect D59.** `packages_name_namespace_unique` is a unique index on
 * `(name, namespace)`, so of several concurrent *first* publishes of one package
 * exactly one insert wins. Measured: five parallel publishes of five different
 * versions left one version on the package, because the other four were returned
 * as failures instead of being folded into the package the index had just created.
 *
 * The error is raised inside the Durable Object and re-thrown in the Worker
 * across workerd's RPC layer, which does **not** carry arbitrary properties — so
 * `err.code` arrives `undefined` and a code-only check never matches. The first
 * version of this handler returned HTTP 500 on precisely that, while the log
 * showed an unambiguous `E11000 duplicate key error`. Hence the message check,
 * which keys on MongoDB's stable error prefix rather than on prose.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  const code = (err as { code?: unknown }).code;
  if (code === 11000 || code === 11001) return true;

  const raw = (err as { message?: unknown }).message;
  const message = typeof raw === "string" ? raw : "";
  return message.startsWith("E11000") || message.includes("duplicate key error");
}
