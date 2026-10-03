/**
 * Registry snapshot archives — `/registry/archives` and `/archives/{name}`.
 *
 * ── The security problem being closed ───────────────────────────────────────
 * `v0.0.1` implemented this as:
 *
 *     folder_path = "static"
 *     file_list = os.listdir(folder_path)
 *     return jsonify({"archives": file_list, "code": 200})
 *
 * `static/` is the top level of the upload directory, so the response listed
 * `packages/`, `temp/`, and — the actual problem — the filename of every
 * `registry-DD-MM-YYYY.tar.gz` full-database `mongodump` produced by
 * `generate_tarball.py`, which runs twice a month on a cron. Unauthenticated.
 * That is defect D5: it hands an attacker the exact name of a complete copy of
 * the registry.
 *
 * ── What this serves instead ────────────────────────────────────────────────
 * Snapshots, stored in R2 under `archives/`, built on demand by a cron trigger.
 * The listing is scoped to that prefix by construction, so nothing outside it can
 * ever be enumerated — the class of bug above is now structurally impossible
 * rather than merely avoided.
 *
 * A snapshot is the package and namespace documents only. **User documents are
 * never included**: an unauthenticated endpoint serving a credential hash dump
 * would be worse than the leak it replaces, and a public registry has no reason
 * to publish accounts.
 */

import type { Env } from "../db/client";
import { db } from "../db/client";
import { jsonError, jsonOk } from "../lib/responses";
import { ENTITY, TTL, entityVersion, serveCached } from "../lib/cache";
import { logger } from "../lib/logger";

export const ARCHIVE_PREFIX = "archives";

/** Only these characters may appear in an archive name. */
const SAFE_ARCHIVE_NAME = /^[A-Za-z0-9._-]{1,128}\.tar\.gz$/;

/**
 * List available snapshots.
 *
 * Returns structured entries rather than bare strings, because the frontend
 * renders `archives` as a list and bare names gave it nothing to display. The
 * `archives` key still holds the names, so a client written against the legacy
 * shape keeps working.
 */
export async function listArchives(request: Request, env: Env): Promise<Response> {
  const internal = new URL("https://internal/registry/archives");

  return serveCached(
    request,
    internal,
    TTL.namespaceIndex,
    await entityVersion(env, "archives"),
    async () => {
      const objects: { name: string; size: number; modified: string }[] = [];

      try {
        let cursor: string | undefined;
        do {
          // Scoped by prefix, so an object outside archives/ can never appear.
          const page = await env.TARBALLS.list({ prefix: ARCHIVE_PREFIX, ...(cursor ? { cursor } : {}) });
          for (const object of page.objects) {
            objects.push({
              name: object.key.slice(ARCHIVE_PREFIX.length + 1),
              size: object.size,
              modified: (object.uploaded ?? new Date()).toISOString(),
            });
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
      } catch (err) {
        logger.error("archive listing failed", { message: err instanceof Error ? err.message : String(err) });
        return jsonError(500, "Internal server error");
      }

      objects.sort((a, b) => (a.modified < b.modified ? 1 : -1));

      return jsonOk({
        message: "Successfully Fetched Archives",
        // Both shapes, so old and new clients both work.
        archives: objects.map((o) => o.name),
        entries: objects,
      });
    },
  );
}

/** Download one snapshot. */
export async function downloadArchive(env: Env, name: string): Promise<Response> {
  // Validate before touching R2. This is the check that stops
  // `GET /archives/../../tarballs/...` from walking out of the prefix.
  if (!SAFE_ARCHIVE_NAME.test(name)) {
    return jsonError(400, "Invalid archive name");
  }

  const key = `${ARCHIVE_PREFIX}/${name}`;
  try {
    const object = await env.TARBALLS.get(key);
    if (!object) return jsonError(404, "Archive not found");

    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": "application/gzip",
        "content-disposition": `attachment; filename="${name}"`,
        "content-length": String(object.size),
        "x-content-type-options": "nosniff",
        "cache-control": `public, max-age=${TTL.tarball}`,
      },
    });
  } catch (err) {
    logger.error("archive download failed", { name, message: err instanceof Error ? err.message : String(err) });
    return jsonError(500, "Internal server error");
  }
}

/**
 * Build a snapshot. Called by the weekly cron.
 *
 * Projects to public fields only, and deliberately never selects `users`. The
 * output is served from an unauthenticated endpoint, so anything sensitive in it
 * would be a disclosure the moment it was written.
 */
export async function buildSnapshot(env: Env): Promise<{ key: string; bytes: number } | null> {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `registry-${stamp}.tar.gz`;
  const key = `${ARCHIVE_PREFIX}/${name}`;

  try {
    const [packages, namespaces] = await Promise.all([
      db<unknown[]>(env, {
        kind: "find",
        collection: "packages",
        filter: {},
        projection: {
          _id: 1, name: 1, namespace: 1, namespace_name: 1, description: 1,
          license: 1, keywords: 1, categories: 1, created_at: 1, updated_at: 1,
          is_deprecated: 1, is_verified: 1, versions: 1, download_count: 1,
        },
      }),
      db<unknown[]>(env, {
        kind: "find",
        collection: "namespaces",
        filter: {},
        projection: { _id: 1, namespace: 1, description: 1, createdAt: 1, packages: 1 },
      }),
    ]);

    // A plain newline-delimited JSON body, gzipped. Deliberately not a
    // mongodump: mongodump is a binary format that needs the mongodump binary to
    // read, and the whole point of `generate_tarball.py` was a portable snapshot.
    const body = await gz(
      JSON.stringify({
        generated_at: new Date().toISOString(),
        generator: "fpm-registry-worker",
        note: "Public registry data only. User accounts are never included.",
        counts: { packages: packages?.length ?? 0, namespaces: namespaces?.length ?? 0 },
        packages: toPlain(packages ?? []),
        namespaces: toPlain(namespaces ?? []),
      }),
    );

    await env.TARBALLS.put(key, body, {
      httpMetadata: { contentType: "application/gzip" },
    });

    // Retire the listing so the new archive is visible immediately.
    await bumpArchiveVersion(env);
    logger.info("snapshot built", { key, bytes: body.byteLength });

    return { key, bytes: body.byteLength };
  } catch (err) {
    logger.error("snapshot failed", { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Drop every archive but the most recent `keep`, bounding R2 usage. */
export async function pruneArchives(env: Env, keep = 3): Promise<number> {
  try {
    // Paginate: R2 lists return at most 1000 keys, so a single `list()` call
    // would only ever prune the newest page and let stale archives pile up
    // beyond it (same cursor pattern as pruneOrphanedTarballs/storageUsage).
    const objects: { key: string; uploaded?: Date }[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.TARBALLS.list({ prefix: ARCHIVE_PREFIX, cursor });
      objects.push(...page.objects);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    const sorted = [...objects].sort((a, b) =>
      (a.uploaded?.getTime() ?? 0) < (b.uploaded?.getTime() ?? 0) ? 1 : -1,
    );
    const stale = sorted.slice(keep);
    for (const object of stale) await env.TARBALLS.delete(object.key);
    if (stale.length > 0) {
      await bumpArchiveVersion(env);
      logger.info("pruned archives", { removed: stale.length });
    }
    return stale.length;
  } catch (err) {
    logger.error("archive prune failed", { message: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

async function bumpArchiveVersion(env: Env): Promise<void> {
  const now = String(Date.now());
  try {
    await env.CACHE.put(`ver:archives`, now, { expirationTtl: 86_400 });
  } catch {
    /* the TTL will expire it anyway */
  }
}

/**
 * Minimal gzip, via CompressionStream.
 *
 * `node:zlib` is available under `nodejs_compat` but CompressionStream is the
 * runtime-native path and needs no polyfill. It is async, hence the wrapper.
 */
async function gz(input: string): Promise<ArrayBuffer> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

/** BSON-safe conversion, so `JSON.stringify` does not emit `{}` for a Date. */
function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object") {
    const asHex = (value as { toHexString?: () => string }).toHexString;
    if (typeof asHex === "function") return asHex.call(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toPlain(v);
    return out;
  }
  if (typeof value === "bigint") return Number(value);
  return value;
}

export { ENTITY };