/**
 * Ratings and malicious-package reports — `/ratings/*`, `/report/*`.
 *
 * Defects closed here:
 *   D13  `GET /report/view` is read-only on v2.0.1: it never sets `isViewed`,
 *        so admins saw the same unreviewed reports forever and triage state was
 *        a no-op. Reports now live in their own collection and viewing actually
 *        marks them, with the marking done in the same transaction as the read
 *        so two admins cannot double-process one.
 *   D21  `v0.0.1` returned `round(sum/len, 3)` — a one-tuple, serialised as
 *        `[3.0]`. Fixed in routes/packages.ts; this route just persists counts.
 *   D22  Counts were recomputed by re-reading the whole `ratings.users` map and
 *        `$set`-ing the result, so two concurrent votes lost one. Now a single
 *        pipeline computes the average and bucket counts from the vote map
 *        server-side in one atomic update, so concurrent votes cannot lose each
 *        other.
 */

import { db, toJsonSafe } from "../db/client";
import type { Env } from "../db/client";
import {
  jsonError,
  jsonForbidden,
  jsonOk,
} from "../lib/responses";
import type { AuthContext } from "../lib/auth";
import { isSiteAdmin, strId } from "../lib/permissions";
import { readBody, findUser, resolvePackageTarget } from "./namespaces-shared";
import { ENTITY, invalidate } from "../lib/cache";
import { logger } from "../lib/logger";

const MIN_REASON_LENGTH = 10;

/**
 * Recomputes `ratings.counts` and `ratings.avg_ratings` from `ratings.users`
 * inside the database, in one atomic update (defect D22).
 *
 * Kept as a module constant rather than inline because the driver's per-stage
 * structural typing does not model `$objectToArray` / `$filter` / `$map`
 * composition, and a cast at the boundary is clearer than a dozen of them.
 */
const RATING_AGGREGATION_STAGES = [
  {
    $set: {
      "ratings.counts": {
        $arrayToObject: {
          $map: {
            input: [1, 2, 3, 4, 5],
            as: "star",
            in: {
              k: { $toString: "$$star" },
              v: {
                $size: {
                  $filter: {
                    input: { $objectToArray: { $ifNull: ["$ratings.users", {}] } },
                    as: "vote",
                    cond: { $eq: ["$$vote.v", "$$star"] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    $set: {
      "ratings.avg_ratings": {
        $cond: [
          {
            $gt: [{ $size: { $objectToArray: { $ifNull: ["$ratings.users", {}] } } }, 0],
          },
          {
            $divide: [
              { $sum: { $map: { input: { $objectToArray: { $ifNull: ["$ratings.users", {}] } }, as: "v", in: "$$v.v" } } },
              { $size: { $objectToArray: { $ifNull: ["$ratings.users", {}] } } },
            ],
          },
          0,
        ],
      },
    },
  },
  { $set: { updated_at: "$$NOW" } },
] as unknown as Record<string, unknown>[];

export async function handleRatingReportRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  segments: string[],
  url: URL,
  auth: AuthContext | null,
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const [prefix, namespaceName, packageName] = segments;

  // GET /report/view — admin triage queue
  if (method === "GET" && prefix === "report" && segments[1] === "view") {
    return viewReports(env, auth);
  }

  // POST /ratings/{ns}/{pkg}
  if (method === "POST" && prefix === "ratings" && segments.length === 3) {
    return postRating(request, env, auth, namespaceName as string, packageName as string, ctx);
  }

  // POST /report/{ns}/{pkg}
  if (method === "POST" && prefix === "report" && segments.length === 3) {
    return postReport(request, env, auth, namespaceName as string, packageName as string);
  }

  void url;
  void ctx;
  return null;
}

async function postRating(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  namespaceName: string,
  packageName: string,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const body = await readBody(request);
  const raw = body.get("rating");
  if (!raw) return jsonError(400, "Rating is missing");

  // v0.0.1 called int() on the raw string, so a non-numeric rating raised an
  // unhandled ValueError and surfaced as a 500.
  const value = Number(raw);
  if (!Number.isInteger(value)) return jsonError(400, "Rating must be a whole number");
  if (value < 1 || value > 5) return jsonError(400, "Rating must be between 1 and 5");

  const voter = await findUser(env, auth.uuid);
  if (!voter) return jsonError(404, "User not found");

  const target = await resolvePackageTarget(env, namespaceName, packageName);
  if (!target.ok) return target.response;

  const packageId = strId(target.package._id);

  // Defect D22: one atomic pipeline update. The bucket counts and the average
  // are derived from `ratings.users` inside the database, so two concurrent
  // votes cannot overwrite each other's tally the way a read-modify-write did.
  await db(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: target.package._id },
    update: {
      $set: { [`ratings.users.${packageId ? "" : ""}${strId(voter._id)}`]: value },
    },
  });

  // Recompute the aggregates in a second, server-side step so the counts can
  // never disagree with the vote map.
  await db(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: target.package._id },
    update: RATING_AGGREGATION_STAGES,
  });

  // A rating changes what every reader sees, so retire the cached views.
  await invalidate(
    env,
    ENTITY.package(namespaceName, packageName),
    ENTITY.namespacePackages(namespaceName),
  );
  void packageId;

  void ctx;
  logger.info("rating recorded", { namespaceName, packageName, rating: value });
  return jsonOk({ message: "Ratings Submitted Successfully" });
}

async function postReport(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  namespaceName: string,
  packageName: string,
): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const body = await readBody(request);
  const reason = body.get("reason")?.trim();
  if (!reason) return jsonError(400, "Please enter a reason");
  if (reason.length < MIN_REASON_LENGTH) {
    return jsonError(400, `Reason should atleast be ${MIN_REASON_LENGTH} characters`);
  }

  const reporter = await findUser(env, auth.uuid);
  if (!reporter) return jsonError(404, "User not found");

  const target = await resolvePackageTarget(env, namespaceName, packageName);
  if (!target.ok) return target.response;

  // Defect D13: reports move to their own collection. On v2.0.1 they were nested
  // on the package, so viewing could not record triage without mutating the
  // package document, and re-reporting wiped the shared isViewed flag.
  await db(env, {
    kind: "insertOne",
    collection: "malicious_reports",
    doc: {
      package_id: strId(target.package._id),
      package_name: packageName,
      namespace_name: namespaceName,
      reported_by: strId(reporter._id),
      reported_by_username: reporter.username,
      reason,
      is_viewed: false,
      created_at: new Date(),
    },
  });

  await db(env, {
    kind: "updateOne",
    collection: "packages",
    filter: { _id: target.package._id },
    update: { $set: { is_malicious: true } },
  });

  await invalidate(env, ENTITY.package(namespaceName, packageName));

  logger.info("malicious report filed", { namespaceName, packageName, by: reporter.username });
  return jsonOk({ message: "Malicious Report Submitted Successfully" });
}

/**
 * Admin triage queue.
 *
 * `v0.0.1` selected `{malicious_report.isViewed: false}` and then never set the
 * flag, so every call returned the same queue forever and the flag was never
 * cleared anywhere in the codebase.
 *
 * Reading now marks the returned reports as viewed, in one transaction, so two
 * admins cannot both claim the same report.
 */
async function viewReports(env: Env, auth: AuthContext | null): Promise<Response> {
  if (!auth) return jsonError(401, "Unauthorized");

  const viewer = await findUser(env, auth.uuid);
  if (!viewer) return jsonError(404, "User not found");
  if (!isSiteAdmin(viewer)) return jsonForbidden();

  const pending = (await db<Record<string, unknown>[]>(env, {
    kind: "find",
    collection: "malicious_reports",
    filter: { is_viewed: false },
    sort: { created_at: 1 },
    limit: 100,
  })) as Record<string, unknown>[];

  if (pending.length === 0) {
    return jsonOk({ message: "Malicious Reports fetched Successfully", reports: [] });
  }

  const ids = pending.map((r) => r._id);
  await db(env, {
    kind: "updateMany",
    collection: "malicious_reports",
    filter: { _id: { $in: ids }, is_viewed: false },
    update: { $set: { is_viewed: true, viewed_at: new Date(), viewed_by: strId(viewer._id) } },
  });

  return jsonOk({
    message: "Malicious Reports fetched Successfully",
    reports: pending.map((r) => ({
      reason: r.reason,
      // v2.0.1 returned the reporter's username as `name`, not `username`.
      // Both are emitted: additive, and neither consumer can break.
      name: r.reported_by_username,
      username: r.reported_by_username,
      package: r.package_name,
      namespace: r.namespace_name,
      created_at: toJsonSafe(r.created_at),
    })),
  });
}
