import { describe, expect, it } from "vitest";
import { ROUTES } from "../src/lib/route-spec";

/**
 * Deliberately reads source text rather than importing handlers.
 *
 * `routes/archives.ts` imports `db/mongo-pool.ts`, which imports
 * `cloudflare:workers` -- a runtime-only module that does not resolve under
 * Vitest. Importing the handler to assert on it would mean stubbing the whole
 * Durable Object, and this test is about static agreement between two files, so
 * reading the text is both sufficient and honest.
 */

/**
 * Cross-checking the frontend against the backend.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The frontend links archive downloads to `${API}/static/${name}`. That URL has
 * always been correct, because in the Docker deployment **nginx** served the
 * `static/` directory — Flask never saw the request. Migrating the backend to
 * Workers removed the web server, and with it the only thing that made that URL
 * resolve. Nothing failed at build time or in CI: the archives page rendered
 * working-looking links that 404'd in production.
 *
 * That is a whole class of bug that only appears when you delete a layer, and
 * it is invisible to unit tests on either side. So this file pins the specific
 * URLs the frontend hard-codes, which means removing the alias again breaks the
 * build rather than production.
 *
 * The list is deliberately hand-maintained rather than scraped from the frontend
 * source. Scraping would re-derive it on every change and quietly agree with
 * whatever the frontend does; the point here is to notice when the two *diverge*.
 */

import { readFileSync } from "node:fs";

function readSource(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const archivesSource = readSource("../src/routes/archives.ts");

const routerSource = readSource("../src/router.ts");

/** Every URL the frontend hard-codes, with the verb it uses. */
const FRONTEND_HARDCODED_URLS: { verb: string; path: string; where: string }[] = [
  {
    verb: "GET",
    path: "/registry/archives",
    where: "store/actions/archivesActions.js",
  },
  {
    verb: "GET",
    path: "/static/{name}",
    where: "pages/archives.js — archive download href",
  },
  {
    verb: "GET",
    path: "/packages/{namespace}/{package}",
    where: "pages/package.js — built from ver.download_url",
  },
];

describe("URLs the frontend hard-codes", () => {
  it.each(FRONTEND_HARDCODED_URLS)("routes $verb $path ($where)", ({ verb, path }) => {
    // Two independent claims, because either can fail alone. A route can be
    // documented and unrouted -- which is exactly the state this file was
    // written for, where route-spec listed `/static/{name}` while router.ts had
    // no branch for it. Checking only the spec, or only the router, would have
    // missed it.
    const documented = ROUTES.some(
      (r) =>
        r.method === verb &&
        r.path
          .split("/")
          .every((seg, i) => seg.startsWith("{") || seg === path.split("/")[i]),
    );
    expect(
      documented,
      `${verb} ${path} is linked by the frontend but absent from the route table`,
    ).toBe(true);

    const firstSegment = path.split("/")[1];
    expect(
      routerSource.includes(`"${firstSegment}"`),
      `${verb} ${path}: the router never mentions "${firstSegment}", so it would 404`,
    ).toBe(true);
  });

  it("serves the legacy /static/{name} archive path", () => {
    // The specific regression. `handleTarballRoutes` claims the `static` prefix
    // and has no branch for it, so without an earlier branch this falls through
    // to a 404. Ordering is the whole fix, so assert the ordering too.
    const staticBranch = routerSource.indexOf('seg[0] === "static" && seg.length === 2');
    const tarballBranch = routerSource.indexOf(
      'seg[0] === "tarballs" || seg[0] === "static" || seg[0] === "download"',
    );

    expect(staticBranch, "no /static/{name} branch in the router").toBeGreaterThan(-1);
    expect(tarballBranch, "the tarball branch is gone; re-check this test").toBeGreaterThan(-1);
    expect(
      staticBranch,
      "the /static/{name} branch must precede the tarball prefix branch, which claims `static` and 404s",
    ).toBeLessThan(tarballBranch);
  });

  it("documents both archive paths", () => {
    const paths = ROUTES.filter((r) => r.operationId.startsWith("downloadArchive")).map((r) => r.path);
    expect(paths).toContain("/archives/{name}");
    expect(paths).toContain("/static/{name}");
  });

  it("scopes archives to an R2 prefix rather than the bucket root", () => {
    // The listing must be prefix-scoped, or it enumerates tarballs too. Before
    // this migration `os.listdir("static")` enumerated the whole upload
    // directory, including the filename of every database mongodump (D5).
    expect(archivesSource).toContain('export const ARCHIVE_PREFIX = "archives"');
    expect(archivesSource).toContain("prefix: ARCHIVE_PREFIX");
  });

  it("validates the archive name before touching R2", () => {
    // This regex is what stops `/static/../../tarballs/...` from walking out of
    // the prefix, so it must be a strict allow-list rather than a deny-list.
    expect(archivesSource).toContain("SAFE_ARCHIVE_NAME");
    expect(archivesSource).toMatch(/\^\[A-Za-z0-9\._-\]\{1,128\}\\\.tar\\\.gz\$/);

    // The guard has to run before the R2 read, not merely exist somewhere in the
    // file. Asserting on order is the only way to catch someone moving the
    // check below the lookup.
    const guard = archivesSource.indexOf("!SAFE_ARCHIVE_NAME.test(name)");
    const lookup = archivesSource.indexOf("env.TARBALLS.get(key)");
    expect(guard, "the name guard is missing").toBeGreaterThan(-1);
    expect(lookup, "the R2 lookup is missing").toBeGreaterThan(-1);
    expect(guard, "the name guard must run before the R2 lookup").toBeLessThan(lookup);
  });
});

describe("the maintainer routes", () => {
  const ACTIONS = [
    "maintainer",
    "maintainer/remove",
    "namespace/maintainer",
    "namespace/maintainer/remove",
    "namespace/admin",
    "namespace/admin/remove",
  ];

  it.each(ACTIONS)("has a case for /{username}/%s in the user handler", (action) => {
    const source = readSource("../src/routes/users.ts");
    expect(
      source.includes(`case "${action}":`),
      `/${action} is called by the frontend but has no case in routes/users.ts`,
    ).toBe(true);
  });

  it("declares all six in the route spec", () => {
    const documented = ROUTES.filter((r) => r.path.startsWith("/{username}/")).map((r) => r.path);
    expect(documented).toHaveLength(ACTIONS.length);
  });
});