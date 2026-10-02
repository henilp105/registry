/**
 * OpenAPI 3.1 document generator.
 *
 * Generates from `lib/route-spec.ts`, so the document cannot drift from the code
 * the way a hand-maintained one does.
 *
 * ── What this replaces, and why it mattered ─────────────────────────────────
 * `v2.0.1` rendered Swagger UI at runtime through `flasgger`, from 35
 * hand-written Swagger **2.0** fragments. Those had drifted badly: 54
 * discrepancies against the code (docs/BASELINE_AUDIT.md D32, D41). Concretely —
 *
 *   - `login.yaml` documented a `uuid` response and did not document
 *     `access_token` or `refresh_token` at all, which are the only two fields the
 *     client actually uses.
 *   - Roughly twenty fragments declared a required `uuid` **form field** the code
 *     never read; identity came from the JWT.
 *   - `packages.py` referenced `documentation/search_packages_cli.yaml`, which
 *     does not exist, so `/apidocs` returned 500.
 *   - `/health`, `/latency` and `/registry/archives` had no fragments at all.
 *
 * A generated document cannot repeat any of that: a route that is not declared
 * has no documentation, and a declared response field that the handler never
 * returns is not discoverable from here.
 */

import { ROUTES, type ParamSpec, type RouteSpec } from "./route-spec";

export type OpenApiOptions = {
  version: string;
  environment: string;
};

/**
 * Build an OpenAPI Parameter Object.
 *
 * `schema` must be a nested property, not spread into the parameter itself.
 * Spreading it produces a document that looks right and fails validation --
 * caught by running the output through @readme/openapi-parser.
 */
function paramToParameter(param: ParamSpec): Record<string, unknown> {
  return {
    name: param.name,
    in: param.in,
    // A path parameter is always required, whatever the spec says.
    required: param.in === "path" ? true : param.required,
    description: param.description,
    schema: param.schema ?? { type: "string" },
  };
}

function securityFor(route: RouteSpec): Record<string, unknown>[] | undefined {
  switch (route.security) {
    case "bearer":
      return [{ bearerAuth: [] }];
    case "uploadToken":
      // The upload token is a form field, not a security scheme in the header
      // sense, but it is the credential, so it is documented as one.
      return [{ uploadToken: [] }];
    case "validationSecret":
      return [{ validationSecret: [] }];
    default:
      return undefined;
  }
}

/** The shared envelope, so a consumer can model every response consistently. */
function successSchema(route: RouteSpec): Record<string, unknown> {
  return {
    type: "object",
    required: ["code", "message"],
    description:
      "`code` always mirrors the HTTP status. That is not automatic in the legacy API, " +
      "where nine error paths returned HTTP 200 carrying a 401 or 404 in the body.",
    properties: {
      code: { type: "integer", examples: [200] },
      message: { type: "string" },
    },
    additionalProperties: true,
    allOf: [{ $ref: "#/components/schemas/Envelope" }],
    "x-route-response-note": route.summary,
  };
}

export function buildOpenApi(options: OpenApiOptions): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of ROUTES) {
    const pathItem = (paths[route.path] ??= {});
    if (pathItem[route.method.toLowerCase()] !== undefined) {
      // Two specs for the same method+path would silently overwrite each other in
      // the document, which is exactly the kind of drift this generator exists to
      // prevent. Fail loudly instead.
      throw new Error(`duplicate route spec: ${route.method} ${route.path}`);
    }

    const parameters = [
      ...(route.path.match(/\{(\w+)\}/g) ?? []).map((raw) => {
        const name = (raw as string).slice(1, -1);
        return {
          name,
          in: "path",
          required: true,
          description: `Path segment: ${name}`,
          schema: { type: "string" },
        };
      }),
      ...(route.query ?? []).map(paramToParameter),
    ];

    const requestBody = route.formBody
      ? {
          required: route.formBody.some((f) => f.required),
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: Object.fromEntries(
                  route.formBody.map((f) => [f.name, { ...(f.schema ?? { type: "string" }), description: f.description }]),
                ),
                required: route.formBody.filter((f) => f.required).map((f) => f.name),
              },
            },
          },
        }
      : undefined;

    const responses: Record<string, unknown> = {};
    for (const [status, description] of Object.entries(route.responses)) {
      responses[status] = {
        description,
        content:
          status === "200"
            ? { "application/json": { schema: successSchema(route) } }
            : { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } },
      };
    }

    pathItem[route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      tags: route.tags,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      ...(securityFor(route) ? { security: securityFor(route) } : {}),
      responses,
      ...(route.cacheable ? { "x-cacheable": true } : {}),
      ...(route.notes ? { description: route.notes } : {}),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "fpm Registry API",
      version: options.version,
      summary: "Package registry for fpm, the Fortran package manager.",
      description: [
        "Serverless rewrite of the fpm registry backend: Cloudflare Workers + Durable Objects +",
        "MongoDB Atlas + R2, on free tiers throughout.",
        "",
        "**Contract notes.** Two conventions are load-bearing and are enforced across every",
        "endpoint: a success is HTTP 2xx *and* a body containing `code: 200`; a failure is a",
        "non-2xx status *and* a body of `{ code, message }`. The legacy implementation broke both",
        "in nine places.",
        "",
        "See `docs/API_CONTRACT.md` for the frozen contract and `docs/BASELINE_AUDIT.md` for the",
        "defects this migration closed.",
      ].join("\n"),
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/", description: `${options.environment} deployment` }],
    tags: [
      { name: "meta", description: "Service metadata, health and archives" },
      { name: "auth", description: "Authentication, tokens and email verification" },
      { name: "users", description: "Profiles, accounts and admin" },
      { name: "maintainers", description: "Package and namespace membership" },
      { name: "namespaces", description: "Namespace lifecycle and publish tokens" },
      { name: "packages", description: "Search, metadata, upload and lifecycle" },
      { name: "ratings", description: "Package ratings" },
      { name: "reports", description: "Malicious package reports and triage" },
      { name: "tarballs", description: "Artifact download" },
      { name: "internal", description: "Called by GitHub Actions; not for clients" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "HS256 access token. Identity comes from the `sub` claim.",
        },
        uploadToken: {
          type: "apiKey",
          in: "query",
          name: "upload_token",
          description:
            "A 7-day publish token, sent as the `upload_token` form field. `POST /packages` has " +
            "no JWT auth: the token is the credential.",
        },
        validationSecret: {
          type: "http",
          scheme: "bearer",
          description:
            "The dedicated VALIDATION_SECRET used by the GitHub Actions callback. Deliberately " +
            "separate from the JWT secret: it can mark any package as verified.",
        },
      },
      schemas: {
        Envelope: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "integer", description: "Mirrors the HTTP status." },
            message: { type: "string" },
          },
        },
        PackageVersion: {
          type: "object",
          required: ["version", "download_url"],
          properties: {
            version: { type: "string", examples: ["0.10.0"] },
            download_url: {
              type: "string",
              description: "Root-relative. The frontend concatenates it onto the API base directly.",
              examples: ["/tarballs/stdlib/json-fortran/0.10.0"],
            },
            created_at: { type: "string", format: "date-time" },
            sha256: { type: "string", description: "Artifact digest, recorded since this migration." },
            size: { type: "integer" },
            is_verified: { type: "boolean" },
            is_deprecated: { type: "boolean" },
            isDeprecated: {
              type: "string",
              enum: ["true", "false"],
              description:
                "Additive alias of `is_deprecated`. The frontend compares this against the string " +
                "\"true\", so both are emitted.",
            },
          },
        },
        Package: {
          type: "object",
          properties: {
            name: { type: "string" },
            namespace: { type: "string" },
            description: { type: "string" },
            keywords: { type: "array", items: { type: "string" } },
            updated_at: { type: "string", format: "date-time" },
            latest_version_data: { oneOf: [{ $ref: "#/components/schemas/PackageVersion" }, { type: "null" }] },
            version_history: { type: "array", items: { $ref: "#/components/schemas/PackageVersion" } },
            ratings: {
              oneOf: [{ type: "number" }, { type: "null" }],
              description:
                "A number. v0.0.1 returned round(sum/len, 3), a one-tuple, which serialised as " +
                "the JSON array [3.0].",
            },
            ratings_count: { type: "object", additionalProperties: { type: "integer" } },
            downloads: { type: "integer" },
          },
        },
      },
    },
    "x-generated-from": "worker/src/lib/route-spec.ts",
    paths,
  };
}

/** Route count, for the health endpoint. */
export const ROUTE_COUNT = ROUTES.length;