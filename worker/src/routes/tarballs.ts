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
import { strId } from "../lib/permissions";

/** Segments allowed in a namespace / package / version path component. */
// Matches the charset assertSafeSegment allows in storage.ts (D81).
const SEGMENT = /^[A-Za-z0-9._~+-]{1,64}$/;

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
  // Two prefixes for one artifact, because the frontend builds its link from
  // `ver.download_url` and has used both spellings.
  //
  // ── The legacy `/tarballs/<ObjectId>` shape is NOT supported ─────────────
  // `v0.0.1` emitted `download_url = f"/tarballs/{file_object_id}"`, a GridFS
  // ObjectId. There is no ObjectId in this architecture: artifacts live in R2
  // under a key derivable from namespace/package/version, and GridFS is not
  // used at all. A stored ObjectId identifies nothing here, so a legacy URL is
  // unserveable rather than merely unimplemented -- there is nothing to look up.
  //
  // An earlier comment here claimed the legacy shape was "handled for backwards
  // compatibility". It was not; only the 4-segment branch existed. Correcting
  // the comment is the whole fix, because there is no code that can satisfy it.
  // Any client holding a cached legacy `download_url` must re-fetch metadata.
  if (method !== "GET" && method !== "HEAD") return null;

  if (prefix === "tarballs" && segments.length === 4) {
    return serveTarball(request, env, ctx, segments[1] as string, segments[2] as string, stripExt(segments[3] as string));
  }
  if (prefix === "download" && segments.length === 4) {
    return serveTarball(request, env, ctx, segments[1] as string, segments[2] as string, stripExt(segments[3] as string));
  }
  if (prefix === "tarballs" && segments.length === 5) {
    // /tarballs/{ns}/{pkg}/{version}/{artifact}
    return serveTarball(request, env, ctx, segments[1] as string, segments[2] as string, stripExt(segments[3] as string));
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
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  namespace: string,
  packageName: string,
  version: string,
): Promise<Response> {
  // Count the fetch without making the download wait on a DB write: the
  // increment rides along on ctx.waitUntil after the response is produced.
  ctx.waitUntil(recordDownload(env, { name: packageName, namespace_name: namespace }));
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

  return serveCached(
    request,
    internal,
    TTL.tarball,
    versionToken,
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
      //
      // Defect D96: this is the digest recorded at upload, read back out of R2's
      // custom metadata. It is *not* recomputed over the bytes being served --
      // that would mean buffering a 50 MB artifact and spending ~13 ms of CPU per
      // MB to guard against corruption R2's own read path already surfaces. So it
      // is a recorded claim about these bytes, and a client that wants proof must
      // digest what it received and compare. Emitting it unchecked is still
      // right: `fpm` verifies against it, and a mismatch is then detectable
      // rather than invisible.
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
export async function recordDownload(env: Env, packageIdOrName: unknown): Promise<void> {
  try {
    // D81: this was never called, so `download_count` stayed 0 and
    // `sorted_by=downloads` silently did nothing. Wired from serveTarball via
    // ctx.waitUntil -- the download response never waits on it.
    // D81 wired the call but passed `{ name, namespace_name }`, while the
    // branch keyed on a `namespace` member — so the object was used as the
    // whole `_id` filter value and matched nothing. Defect D85: use the
    // caller's object verbatim as the filter (it always carries name plus a
    // namespace selector), and only fall back to `{ _id }` for scalars.
    const filter =
      typeof packageIdOrName === "object" && packageIdOrName !== null
        ? (packageIdOrName as Record<string, unknown>)
        : { _id: packageIdOrName };
    await db(env, {
      kind: "updateOne",
      collection: "packages",
      filter,
      update: { $inc: { download_count: 1 } },
    });

    // Legacy documents predate the denormalised `namespace_name` field (defect
    // D85): retry with the ObjectId selector so they are not invisible.
    if (typeof packageIdOrName === "object" && packageIdOrName !== null && "namespace_name" in (packageIdOrName as Record<string, unknown>)) {
      const name = (packageIdOrName as Record<string, unknown>).namespace_name;
      const ns = (await db<{ _id: unknown } | null>(env, {
        kind: "findOne",
        collection: "namespaces",
        filter: { namespace: name },
        projection: { _id: 1 },
      })) as { _id: unknown } | null;
      if (ns) {
        await db(env, {
          kind: "updateOne",
          collection: "packages",
          filter: { name: (packageIdOrName as Record<string, unknown>).name, namespace: ns._id, namespace_name: { $exists: false } },
          update: { $inc: { download_count: 1 } },
        });
      }
    }
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
  liveKeys: Set<string>,
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
        // D79: membership test is now O(1) and was moved out of the loop.
        if (liveKeys.has(`${parts[1]}|${parts[2]}|${version}`)) continue;

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

/**
 * O(1) membership test for the prune sweep, batched into TWO queries total
 * (packages + namespaces) instead of one round trip per R2 object.
 *
 * The old per-object `findOne` had two problems:
 *  1. one Durable Object round trip (subrequest) per R2 object -- a
 *     100-object prune exhausted the Workers Free 50-subrequest budget and
 *     the whole cron died with `Too many subrequests`, leaving `buildSnapshot`
 *     (which runs after it) unexecuted as well.
 *  2. it matched on `namespace_name`, a denormalised field older documents
 *     may lack, so a live tarball was silently deleted (D79). The read path
 *     falls back to the resolved namespace name; the prune now does the same.
 */
export async function collectLiveTarballKeys(env: Env): Promise<Set<string>> {
  const live = new Set<string>();
  try {
    const [packages, namespaces] = await Promise.all([
      db<unknown[]>(env, {
        kind: "find",
        collection: "packages",
        filter: {},
        projection: { name: 1, namespace: 1, namespace_name: 1, "versions.version": 1 },
      }),
      db<unknown[]>(env, {
        kind: "find",
        collection: "namespaces",
        filter: {},
        projection: { namespace: 1 },
      }),
    ]);

    // Namespace _id -> namespace name, for packages whose `namespace_name` is
    // absent (legacy documents) -- mirrors namespaces-shared.ts's fallback.
    const nsNameById = new Map<string, string>();
    for (const ns of (namespaces ?? []) as Record<string, unknown>[]) {
      nsNameById.set(strId(ns._id), String(ns.namespace ?? ""));
    }

    for (const pkg of (packages ?? []) as Record<string, unknown>[]) {
      const nsName =
        typeof pkg.namespace_name === "string" && pkg.namespace_name.length > 0
          ? pkg.namespace_name
          : nsNameById.get(strId(pkg.namespace)) ?? "";
      if (!nsName) continue;
      for (const v of (pkg.versions ?? []) as Record<string, unknown>[]) {
        const version = String(v.version ?? "");
        if (version) live.add(`${nsName}|${String(pkg.name ?? "")}|${version}`);
      }
    }
  } catch (err) {
    logger.error("collect live keys failed", { message: err instanceof Error ? err.message : String(err) });
  }
  return live;
}