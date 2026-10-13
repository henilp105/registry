/**
 * Regression tests for the `/packages_cli` parameter contract.
 *
 * Defect D200: the route read `/packages`' `sorted_by` and ignored the fpm
 * CLI's `sort_by`, and it never honoured `version` at all. So
 * `fpm search --sort-by downloads` sorted as if by name and
 * `fpm search --package_version 0.1.0` returned packages regardless of their
 * versions. `cliSearchOptions` is where the CLI parameters are mapped, so
 * pinning it here catches the regression without a live database.
 */

import { describe, expect, it } from "vitest";
import { cliSearchOptions } from "../src/lib/search";

const opts = (qs: string) => cliSearchOptions(new URL(`https://registry.test/packages_cli?${qs}`));

describe("cliSearchOptions", () => {
  it("honours the CLI's sort_by, not just /packages' sorted_by", () => {
    expect(opts("sort_by=downloads").sortField).toBe("download_count");
    expect(opts("sort_by=downloads&sort=desc").direction).toBe(-1);
    expect(opts("sort_by=updatedat").sortField).toBe("updated_at");
    // Back-compat with the web route's spelling.
    expect(opts("sorted_by=createdat").sortField).toBe("created_at");
    // An unknown field falls back to name instead of matching nothing.
    expect(opts("sort_by=nonsense").sortField).toBe("name");
  });

  it("matches the CLI's own defaults when nothing is sent", () => {
    const o = opts("");
    expect(o.sortField).toBe("name");
    expect(o.direction).toBe(1);
    expect(o.filters).toEqual({});
    expect(o.version).toBeNull();
  });

  it("treats `*` and empty strings as 'any'", () => {
    const o = opts("namespace=*&package=*&license=*&version=*");
    expect(o.filters).toEqual({});
    expect(o.version).toBeNull();
  });

  it("filters by version, which used to be ignored", () => {
    const o = opts("version=0.1.0");
    expect(o.version).toBe("0.1.0");
    expect(o.filters["versions.version"]).toEqual({ $regex: "^0\\.1\\.0", $options: "i" });
  });

  it("escapes regex metacharacters in every filter", () => {
    const o = opts("package=a.b&namespace=ns(1)&license=MIT*");
    expect(o.filters.name).toEqual({ $regex: "^a\\.b", $options: "i" });
    expect(o.filters.namespace_name).toEqual({ $regex: "^ns\\(1\\)", $options: "i" });
    expect(o.filters.license).toEqual({ $regex: "MIT\\*", $options: "i" });
  });
});
