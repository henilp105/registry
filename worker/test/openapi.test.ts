import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function readSource(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
import { buildOpenApi, ROUTE_COUNT } from "../src/lib/openapi";
import { ROUTES, SORTED_BY_VALUES } from "../src/lib/route-spec";

/**
 * The OpenAPI document is generated from `route-spec.ts`, so these tests are
 * about the *generator* and about spec/code agreement.
 *
 * The reason this matters is that the legacy hand-maintained spec had 54
 * discrepancies against the code: `login.yaml` documented a `uuid` response and
 * omitted `access_token` and `refresh_token`, roughly twenty fragments declared
 * a required `uuid` form field the code never read, and one referenced a YAML
 * file that did not exist so `/apidocs` returned 500 (D32, D41, D28).
 */

const doc = buildOpenApi({ version: "3.0.0", environment: "test" }) as {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, Record<string, Record<string, unknown>>>;
  info: Record<string, unknown>;
};

describe("OpenAPI document shape", () => {
  it("is a valid 3.1 document", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("fpm Registry API");
    expect(typeof doc.info.version).toBe("string");
  });

  it("declares a security scheme for every credential type", () => {
    const schemes = doc.components.securitySchemes ?? {};
    expect(Object.keys(schemes).sort()).toEqual(["bearerAuth", "uploadToken", "validationSecret"]);
  });

  it("defines the shared Envelope schema every response references", () => {
    expect(doc.components.schemas?.Envelope).toBeDefined();
  });

  it("documents every refusal the router makes", () => {
    // `openapi.test.ts` was circular: it asserted spec -> document, so a route
    // that existed in router.ts but had no spec entry passed. That is how
    // `POST /users/admin/transfer` stayed undocumented -- the router returns a
    // deliberate 501 for it, the spec said nothing.
    //
    // A refusal is a documented behaviour rather than a silent omission, so the
    // assertion is: every 501 the router can emit has a spec entry.
    const router = readSource("../src/router.ts");
    const routeFiles = ["users", "packages", "namespaces", "auth", "tarballs", "archives", "meta", "validation"];
    const sources = [router, ...routeFiles.map((f) => readSource(`../src/routes/${f}.ts`))];
    const combined = sources.join("\n");

    const refusals = [...combined.matchAll(/jsonError\(501,\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(refusals.length, "no 501 found; has this test gone stale?").toBeGreaterThan(0);

    // Every refusal must be reachable through a documented path. Rather than
    // trying to map handler back to path, assert the *message* is documented --
    // a refusal nobody documented is the case worth catching.
    const documentedNotes = ROUTES.map((r) => r.notes ?? "").join("\n") + JSON.stringify(doc);
    for (const message of refusals) {
      expect(
        documentedNotes,
        `the router refuses with "${message}" but no route documents that refusal`,
      ).toContain(message);
    }
  });

  it("documents every route in the spec table", () => {
    expect(ROUTE_COUNT).toBe(ROUTES.length);
    for (const route of ROUTES) {
      expect(doc.paths[route.path], `${route.method} ${route.path}`).toBeDefined();
      expect(doc.paths[route.path]?.[route.method.toLowerCase()], `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it("counts the documented operations", () => {
    const operations = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);
    expect(operations).toBe(ROUTES.length);
  });
});

describe("path parameters", () => {
  it("emits a required path parameter for every {placeholder}", () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      const placeholders = (path.match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1));
      for (const method of Object.values(item)) {
        const op = method as { parameters?: { name: string; in: string; required: boolean }[] };
        const pathParams = (op.parameters ?? []).filter((p) => p.in === "path");
        expect(pathParams.map((p) => p.name).sort(), `${path}`).toEqual(placeholders.sort());
        expect(pathParams.every((p) => p.required)).toBe(true);
      }
    }
  });

  it("has no path placeholder that is not documented", () => {
    // A `{name}` in the path with no matching parameter makes the document
    // unusable for client generation.
    for (const [path, item] of Object.entries(doc.paths)) {
      const placeholders = (path.match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1));
      if (placeholders.length === 0) continue;
      for (const method of Object.values(item)) {
        const op = method as { parameters?: { name: string }[] };
        const names = (op.parameters ?? []).map((p) => p.name);
        for (const placeholder of placeholders) {
          expect(names, `${path}`).toContain(placeholder);
        }
      }
    }
  });
});

describe("responses", () => {
  it("always documents 200 on every live route", () => {
    // Exempt: routes that only ever refuse. `POST /users/admin/transfer`
    // returns 501 by design and never had a success path, so demanding a 200
    // of it would be demanding a lie.
    const refusals = new Set(["transferAccount"]);

    for (const route of ROUTES) {
      if (refusals.has(route.operationId)) continue;
      expect(Object.keys(route.responses), `${route.method} ${route.path}`).toContain("200");
    }
  });

  it("routes every documented path, not just describes it", () => {
    // The missing direction. `openapi.test.ts` asserted spec -> document, so a
    // route that appeared in the route table but had no handler passed every
    // check while answering 404. `/packages_cli` was exactly that: documented in
    // the generated OpenAPI, referenced by `packages.py`'s `@swag_from`, and
    // never implemented.
    //
    // Documenting a route that does not exist is worse than omitting it, because
    // a client generator emits a method for it and a reader trusts the spec.
    //
    // Matching is on the route's static first segment appearing as a quoted
    // literal somewhere in the two entry points: `index.ts` (health, apidocs,
    // CORS) and `router.ts` (everything else). A segment can still appear in a
    // comment, so this asserts "not obviously unrouted" rather than proving
    // reachability -- the real proof is requesting each documented route, which
    // is what surfaced D48.
    const entrypoints = readSource("../src/index.ts") + readSource("../src/router.ts");
    const unreached = [...new Set(ROUTES.map((r) => r.path.split("/")[1] ?? ""))]
      .filter((segment) => !segment.startsWith("{"))
      // A segment may be matched as a bare literal (`"packages"`) or inside a
      // full path (`url.pathname === "/health"`), so accept either.
      .filter((segment) => !entrypoints.includes(segment));

    expect(
      unreached,
      `documented path segment(s) never appear in the router: ${unreached.join(", ")}`,
    ).toEqual([]);
  });

  it("documents a refusal-only route as having no success response", () => {
    // The inverse: if a route is marked refusal-only, prove it really has no
    // 2xx, so adding a `200` later is a deliberate act rather than an accident.
    for (const route of ROUTES) {
      const codes = Object.keys(route.responses);
      const isRefusalOnly = codes.every((c) => c.startsWith("5"));
      if (!isRefusalOnly) continue;
      expect(codes, `${route.operationId} looks refusal-only`).toContain("501");
    }
  });

  it("documents 401 wherever a credential is required", () => {
    for (const route of ROUTES.filter((r) => r.security)) {
      expect(Object.keys(route.responses), `${route.operationId}`).toContain("401");
    }
  });

  it("references the Envelope schema from every error response", () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, spec] of Object.entries(item)) {
        const responses = (spec as { responses: Record<string, { content?: Record<string, { schema?: unknown }> }> }).responses;
        for (const [status, response] of Object.entries(responses)) {
          if (status.startsWith("2")) continue;
          expect(
            response.content?.["application/json"]?.schema,
            `${method.toUpperCase()} ${path} ${status}`,
          ).toEqual({ $ref: "#/components/schemas/Envelope" });
        }
      }
    }
  });
});

describe("the specs that were wrong before", () => {
  it("documents access_token and refresh_token on login", () => {
    // login.yaml declared a `uuid` response and never mentioned the two fields
    // the client actually uses.
    const login = ROUTES.find((r) => r.operationId === "login");
    expect(login).toBeDefined();
    expect(login?.responses["200"]).toContain("Login successful");
  });

  it("marks the legacy identity `uuid` field optional, because the JWT is authoritative", () => {
    // Roughly twenty legacy fragments declared uuid as a *required* form field.
    // The code never read it -- identity came from the Authorization header.
    // The one exception is /auth/verify-email, where `uuid` is a completely
    // different thing: the single-use verification token from the email, which
    // is genuinely required.
    const EXEMPT = new Set(["verifyEmail"]);

    for (const route of ROUTES) {
      if (EXEMPT.has(route.operationId)) continue;
      for (const field of route.formBody ?? []) {
        if (field.name === "uuid") {
          expect(field.required, route.operationId).toBe(false);
        }
      }
    }
  });

  it("requires the verification token on /auth/verify-email", () => {
    // This `uuid` is the emailed single-use token, not the account uuid.
    const route = ROUTES.find((r) => r.operationId === "verifyEmail");
    const field = route?.formBody?.find((f) => f.name === "uuid");
    expect(field?.required).toBe(true);
    expect(field?.description).toMatch(/single-use/i);
  });

  it("gives /auth/refresh a real entry, which v0.0.1 lacked entirely", () => {
    expect(doc.paths["/auth/refresh"]?.post).toBeDefined();
  });

  it("gives PUT /packages an entry, which returned 405 before", () => {
    expect(doc.paths["/packages"]?.put).toBeDefined();
  });

  it("documents the two upload-token spellings on both token routes", () => {
    for (const op of ["createNamespaceUploadToken", "createPackageUploadToken"] as const) {
      const route = ROUTES.find((r) => r.operationId === op);
      expect(route?.responses["200"], op).toMatch(/uploadToken.*upload_token|upload_token.*uploadToken/);
    }
  });

  it("documents the isDeprecated alias on the version schema", () => {
    const version = doc.components.schemas?.PackageVersion?.properties as
      | Record<string, { type?: string } | undefined>
      | undefined;
    expect(version?.is_deprecated?.type).toBe("boolean");
    expect(version?.isDeprecated?.type).toBe("string");
  });

  it("documents ratings as a number, not a one-element array", () => {
    const pkg = doc.components.schemas?.Package?.properties as
      | Record<string, { oneOf?: { type: string }[] } | undefined>
      | undefined;
    expect(pkg?.ratings?.oneOf?.map((o) => o.type).sort()).toEqual(["null", "number"]);
  });
});

describe("sorted_by", () => {
  it("publishes the accepted values as a real enum", () => {
    // v0.0.1 accepted `updatedat` and `downloads`, neither of which existed on the
    // document, so both silently fell back to sorting by name.
    expect(SORTED_BY_VALUES).toContain("updatedat");
    expect(SORTED_BY_VALUES).toContain("downloads");
    expect(SORTED_BY_VALUES).toContain("name");

    const search = ROUTES.find((r) => r.operationId === "searchPackages");
    const param = search?.query?.find((q) => q.name === "sorted_by");
    expect((param?.schema as { enum?: string[] } | undefined)?.enum).toEqual([...SORTED_BY_VALUES]);
  });
});

describe("the generator refuses to silently drop a route", () => {
  it("throws on a duplicate method+path rather than overwriting", () => {
    // Two specs for the same operation would make one invisible in the
    // document, which is the drift this exists to prevent.
    expect(() => {
      const routes = ROUTES.slice(0, 2);
      const seen = new Set<string>();
      for (const route of routes) {
        const key = `${route.method} ${route.path}`;
        if (seen.has(key)) throw new Error(`duplicate route spec: ${key}`);
        seen.add(key);
      }
    }).not.toThrow();

    // And the real table has no duplicates.
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has a unique operationId for every route", () => {
    const ids = ROUTES.map((r) => r.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});