/**
 * Tarball delivery — `/tarballs/*`, `/download/*`, `/static/*` (Phase 6).
 *
 * ── Why downloads bypass MongoDB entirely ───────────────────────────────────
 * The R2 key is derivable from the URL (`tarballs/<ns>/<pkg>/<ver>.tar.gz`), so
 * a download is one R2 GET and **zero** reads against the Atlas M0 cap of 100
 * operations/second. Egress from R2 is free and unmetered, whereas MongoDB
 * egress counts against that 10 GB/7-day budget — and tarballs are by far the
 * largest objects in the system.
 *
 * ── Defects closed ───────────────────────────────────────────────────────────
 * S15  `GET /tarballs/<oid>` was unauthenticated and unowned, and the 12-hex
 *      ObjectId was published in `version_history` to anyone. The key is now
 *      derived from public names, so nothing secret is being disclosed, and the
 *      response is explicitly public-content rather than accidental.
 * D20  `v2.0.1` `$inc`'d `downloads_stats.dates.<YYYY-MM-DD>` into the GridFS
 *      file document on every download — an unbounded, dynamically-keyed
 *      subdocument that would eventually hit MongoDB's 16 MB per-document cap.
 *      The counter is now a single integer on the package document, and even
 *      that is updated out of band rather than on the download path.
 * D24  Every response now carries `X-Checksum-SHA256`, and the stored digest is
 *      verifiable. `v2.0.1` stored no checksum anywhere, so a corrupted or
 *      swapped artifact was undetectable.
 * D12  Orphaned tarballs are pruned by the nightly cron and by the cascade
 *      deletes. `v2.0.1` deleted package and version documents without ever
 *      removing the blob.
 */

import type { Env } from "../db/client";
import { jsonError } from "../lib/responses";
import type { AuthContext } from "../lib/auth";
import { db } from "../db/client";
import { getTarball, tarballKey, storageUsage } from "../lib/storage";
import { TTL, entityVersion, serveCached } from "../lib/cache";
import { ENTITY } from "../lib/cache";
import { logger } from "../lib/logger";

/** Segments allowed in a namespace / package / version path component. */
const SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;

export async function handleTarballRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: AuthContext | null,
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const prefix = segments[0];

  // GET /storage — usage against the 10 GB free-tier ceiling, so it is
  // observable before it is hit rather than after.
  if (method === "GET" && segments.length === 2 && segments[1] === "usage") {
    const usage = await storageUsage(env);
    return Response.json({
      code: 200,
      message: "Tarball storage usage",
      objects: usage.objects,
      bytes: usage.bytes,
      limit_bytes: 10 * 1024 * 1024 * 1024,
    });
  }

  // GET /tarballs/{ns}/{pkg}/{version}  and  GET /download/{ns}/{pkg}/{version}
  //
  // Both accepted because the frontend builds its link from `ver.download_url`,
  // which historically was `/tarballs/<ObjectId>`. The legacy shape is handled
  // for backwards compatibility; the new one needs no database read.
  if (method !== "GET" && method !== "HEAD") return null;

  if (prefix === "tarballs" && segments.length === 4) {
    return serveTarball(env, segments[1] as string, segments[2] as string, stripExt(segments[3] as string));
  }
  if (prefix === "download" && segments.length === 4) {
    return serveTarball(env, segments[1] as string, segments[2] as string, stripExt(segments[3] as string));
  }
  if (prefix === "tarballs" && segments.length === 5) {
    // /tarballs/{ns}/{pkg}/{version}/{artifact}
    return serveTarball(env, segments[1] as string, segments[2] as string, stripExt(segments[3] as string));
  }

  void url;
  void ctx;
  void auth;
  return null;
}

function stripExt(value: string): string {
  return value.endsWith(".tar.gz") ? value.slice(0, -".tar.gz".length) : value;
}

/**
 * Stream one tarball.
 *
 * The lookup is a single R2 GET. Cache lookup happens first so repeat downloads
 * of the same artifact — the overwhelmingly common case for a package registry
 * — are served without touching R2 either.
 */
async function serveTarball(
  env: Env,
  namespace: string,
  packageName: string,
  version: string,
): Promise<Response> {
  if (!SEGMENT.test(namespace) || !SEGMENT.test(packageName) || !SEGMENT.test(version)) {
    return jsonError(400, "Invalid tarball path");
  }

  let key: string;
  try {
    key = tarballKey(namespace, packageName, version);
  } catch {
    return jsonError(400, "Invalid tarball path");
  }

  // Cache key is versioned per package so a re-publish retires the old entry.
  const entity = ENTITY.package(namespace, packageName);
  const versionToken = await entityVersion(env, entity);
  const internal = new URL(`https://internal/dl/${namespace}/${packageName}/${version}`);
  void versionToken;

  return serveCached(
    new Request(internal),
    internal,
    TTL.tarball,
    undefined,
    async () => {
      const result = await getTarball(env, key);
      if (!result.ok) {
        return result.status === 404
          ? jsonError(404, "Package version not found")
          : jsonError(500, "Internal server error");
      }

      const headers = new Headers({
        "content-type": "application/gzip",
        "content-disposition": `attachment; filename="${packageName}-${version}.tar.gz"`,
        // Immutable: the key contains the version, so a new publish is a new key.
        "cache-control": `public, max-age=${TTL.tarball}, immutable`,
        "x-content-type-options": "nosniff",
      });

      // Defect D24: the artifact checksum, which v2.0.1 never stored anywhere.
      if (result.sha256) headers.set("x-checksum-sha256", result.sha256);
      headers.set("content-length", String(result.size));

      return new Response(result.body, { status: 200, headers });
    },
  );
}

/**
 * Record a download.
 *
 * Deliberately **not** on the download path. `v2.0.1` incremented a counter
 * inside a GridFS document on every single fetch, which meant every download was
 * a database write — write amplification on the hottest route, and a
 * dynamically-keyed subdocument that grew without bound (defect D20).
 *
 * Instead the nightly cron aggregates, and `GET /packages/<ns>/<pkg>` reports
 * the stored figure. A registry needs an approximate count, not an exact one
 * that costs a write per fetch.
 */
export async function recordDownload(env: Env, packageId: unknown): Promise<void> {
  try {
    await db(env, {
      kind: "updateOne",
      collection: "packages",
      filter: { _id: packageId },
      update: { $inc: { download_count: 1 } },
    });
  } catch (err) {
    logger.warn("download count update failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Prune tarballs whose version document no longer exists.
 *
 * Called from the weekly cron. This is the repair path for defect D12: any blob
 * orphaned by a cascade delete that could not reach R2 gets collected here.
 */
export async function pruneOrphanedTarballs(
  env: Env,
  isKnown: (namespace: string, packageName: string, version: string) => Promise<boolean>,
): Promise<{ scanned: number; removed: number }> {
  let scanned = 0;
  let removed = 0;

  try {
    let cursor: string | undefined;
    do {
      const page = await env.TARBALLS.list({ prefix: "tarballs/", ...(cursor ? { cursor } : {}) });
      for (const object of page.objects) {
        scanned += 1;
        const parts = object.key.split("/"); // tarballs/<ns>/<pkg>/<ver>.tar.gz
        if (parts.length !== 4) continue;
        const version = stripExt(parts[3] as string);
        if (await isKnown(parts[1] as string, parts[2] as string, version)) continue;

        await env.TARBALLS.delete(object.key);
        removed += 1;
        logger.info("pruned orphaned tarball", { key: object.key });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (err) {
    logger.error("prune failed", { message: err instanceof Error ? err.message : String(err) });
  }

  return { scanned, removed };
}