/**
 * Environment resolution for the verification harnesses.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Defect D71 — a live credential in version control.
 *
 * Seven harnesses carried the production MongoDB URI, password included, as a
 * hardcoded string. The repository is **public**, so for the whole time those
 * commits existed the Atlas cluster's read/write credential was world-readable:
 * the user collection (with password hashes), every namespace, every package.
 *
 * Hardcoding it was never necessary — the Worker reads `MONGO_URI` from
 * `worker/.dev.vars`, which is gitignored, and the harnesses run in the same
 * shell. So the value was available and nobody had to embed it.
 *
 * This module resolves the URI from the environment and **fails loudly** when it is
 * absent, because a harness that silently skips its checks is worse than one that
 * refuses to start. See also `scripts/check_no_secrets.mjs`, which fails CI if a
 * credential reappears in tracked source.
 */

/**
 * The MongoDB URI the harnesses should use.
 *
 * Resolution order:
 *   1. `MONGODB_TEST_URI` — set by CI, and the right variable for a live-cluster
 *      test. A direct connection string, because a test database wants its own.
 *   2. `MONGO_URI` — what `worker/.dev.vars` provides, i.e. the development
 *      cluster. This is the common local case.
 *
 * @param {string} what - Label used in the error message, so the operator knows
 *   which harness is complaining.
 * @returns {string}
 */
function mongoUri(what = "this harness") {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGO_URI;
  if (uri && uri.trim()) return uri.trim();

  throw new Error(
    `${what} needs a MongoDB URI, and none is set.\n\n` +
      `  Set MONGODB_TEST_URI (preferred, a direct connection string) or MONGO_URI.\n` +
      `  Locally, source worker/.dev.vars, which is gitignored:\n\n` +
      `      set -a && . worker/.dev.vars && set +a\n\n` +
      `  The URI is deliberately NOT hardcoded here or in any other harness. It was\n` +
      `  committed in seven files while the repository was public, which exposed the\n` +
      `  cluster credential to anyone who could read the repository (defect D71).\n` +
      `  If you need a local value, put it in worker/.dev.vars — never in source.`,
  );
}

/**
 * The database name to operate on.
 *
 * Defaults to `fpmregistry_local`, which is what `worker/.dev.vars` sets for local
 * development — deliberately *not* the production `fpmregistry`, so a harness run
 * with only a generic URI cannot write to production by accident.
 *
 * @returns {string}
 */
function mongoDbName() {
  return process.env.MONGO_DB_NAME || "fpmregistry_local";
}

module.exports = { mongoUri, mongoDbName };