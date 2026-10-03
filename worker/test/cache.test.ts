import { describe, expect, it } from "vitest";
import { cacheKey, TTL, ENTITY } from "../src/lib/cache";
import { escapeRegex, clampInt, SORT_MAP, MAX_PAGE_SIZE, planSearch, buildMatchFilter, sortDirection } from "../src/lib/search";

describe("cacheKey", () => {
  it("is stable for the same URL", () => {
    const a = cacheKey(new URL("https://x/packages/ns/pkg"));
    const b = cacheKey(new URL("https://x/packages/ns/pkg"));
    expect(a).toBe(b);
  });

  it("sorts query parameters so parameter order cannot halve the hit rate", () => {
    const a = cacheKey(new URL("https://x/packages?query=json&page=2&sorted_by=name"));
    const b = cacheKey(new URL("https://x/packages?sorted_by=name&page=2&query=json"));
    expect(a).toBe(b);
  });

  it("distinguishes genuinely different queries", () => {
    const a = cacheKey(new URL("https://x/packages?query=json"));
    const b = cacheKey(new URL("https://x/packages?query=hdf5"));
    expect(a).not.toBe(b);
  });

  it("cannot be collided by percent-encoding (D94)", () => {
    // `searchParams` yields decoded components. Concatenating them raw made
    // `?a=1&b=2` and `?a=1%26b%3D2` produce the *same* key -- two different
    // requests, one cached response.
    const two = cacheKey(new URL("https://x/packages?a=1&b=2"));
    const smuggled = cacheKey(new URL("https://x/packages?a=1%26b%3D2"));
    expect(smuggled).not.toBe(two);

    // Same class, different pair of parameters.
    const inline = cacheKey(new URL("https://x/packages?query=a&limit=5"));
    const injected = cacheKey(new URL("https://x/packages?query=a%26limit%3D5"));
    expect(injected).not.toBe(inline);

    // And a smuggled `&` must not be able to impersonate a second parameter that
    // is present in one request and absent in the other.
    const withLimit = cacheKey(new URL("https://x/packages?query=a&limit=5"));
    const hiddenLimit = cacheKey(new URL("https://x/packages?query=a%26limit%3D5&limit=0"));
    expect(hiddenLimit).not.toBe(withLimit);
  });

  it("still folds duplicate parameter names rather than dropping them", () => {
    // Sorting is on name alone and the pairs keep their relative order, so
    // `?a=1&a=2` and `?a=2&a=1` remain distinct values of a real multiset.
    const first = cacheKey(new URL("https://x/packages?a=1&a=2"));
    const second = cacheKey(new URL("https://x/packages?a=2&a=1"));
    expect(first).not.toBe(second);
  });

  it("folds in the invalidation version", () => {
    const before = cacheKey(new URL("https://x/packages/ns/pkg"), "0");
    const after = cacheKey(new URL("https://x/packages/ns/pkg"), "1712345678");
    expect(before).not.toBe(after);
  });

  it("distinguishes paths", () => {
    expect(cacheKey(new URL("https://x/a"))).not.toBe(cacheKey(new URL("https://x/b")));
  });
});

describe("cache TTL policy", () => {
  it("never caches anything carrying a personal email address", () => {
    // GET /users/<username> returns the owner's email to the owner and an
    // admin. A shared cache must not hold that.
    expect(TTL.private).toBe(0);
  });

  it("caches user-reflecting reads only briefly", () => {
    // A user who submits a rating expects to see it. These are deliberately
    // far shorter than package metadata, which changes rarely.
    expect(TTL.ratings).toBeLessThan(TTL.package);
    expect(TTL.reports).toBeLessThan(TTL.ratings);
  });

  it("caches package metadata for minutes, not seconds", () => {
    expect(TTL.package).toBeGreaterThanOrEqual(120);
    expect(TTL.search).toBeLessThan(TTL.package);
  });
});

describe("entity keys", () => {
  it("scopes a package key to its namespace and name", () => {
    expect(ENTITY.package("stdlib", "json")).toBe("pkg:stdlib/json");
  });

  it("separates the namespace key from its package-list key", () => {
    // Both must be invalidated when a package is added or removed, but they are
    // distinct caches — conflating them would retire unrelated entries.
    expect(ENTITY.namespace("stdlib")).not.toBe(ENTITY.namespacePackages("stdlib"));
  });
});

describe("escapeRegex (defect D18 / S23)", () => {
  it("neutralises every regex metacharacter", () => {
    const escaped = escapeRegex("a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o");
    expect(escaped).toBe("a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o");
  });

  it("makes a ReDoS payload inert", () => {
    // (a+)+$ is the classic catastrophic-backtracking pattern.
    const escaped = escapeRegex("(a+)+$");
    expect(escaped).toContain("\\(");
    expect(escaped).toContain("\\)");
    expect(escaped).toContain("\\$");
  });
});

describe("clampInt (defect D19)", () => {
  it("falls back when absent or unparseable", () => {
    expect(clampInt(null, 10, 1, 50)).toBe(10);
    expect(clampInt("abc", 10, 1, 50)).toBe(10);
  });

  it("clamps to the ceiling, so a caller cannot request the whole collection", () => {
    // v2.0.1: `packages_per_page = total_documents if > total_documents`,
    // letting `limit` reach every document in the collection.
    expect(clampInt("100000", 10, 1, MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it("clamps below the floor, so a negative skip cannot be injected", () => {
    expect(clampInt("-5", 0, 0, 10_000)).toBe(0);
  });

  it("truncates rather than rounding, so skip stays an integer", () => {
    expect(clampInt("2.9", 0, 0, 100)).toBe(2);
  });
});

describe("SORT_MAP (docs/API_CONTRACT.md §7.5)", () => {
  it("maps every public sort name to a field that actually exists", () => {
    // v2.0.1 accepted `updatedat` and `downloads` while the document fields are
    // `updated_at`/`created_at` and `download_count`, so both silently fell
    // back to sorting by name.
    expect(SORT_MAP["updatedat"]).toBe("updated_at");
    expect(SORT_MAP["createdat"]).toBe("created_at");
    expect(SORT_MAP["downloads"]).toBe("download_count");
    expect(SORT_MAP["name"]).toBe("name");
    expect(SORT_MAP[""]).toBe("name");
  });

  it("does not map to the legacy snake_case names the backend never used", () => {
    for (const field of Object.values(SORT_MAP)) {
      expect(field).not.toBe("updatedAt");
      expect(field).not.toBe("createdAt");
      expect(field).not.toBe("downloads");
    }
  });
});
describe("planSearch (defect D18)", () => {
  it("uses the weighted $text index for a real query", () => {
    expect(planSearch("json")).toEqual({ kind: "text", term: "json" });
  });

  it("falls back to an anchored prefix for a single character", () => {
    // $text on one character matches nothing useful, so v0.0.1's approach would
    // return an empty page for "a".
    expect(planSearch("j")).toEqual({ kind: "prefix", term: "j" });
  });

  it("treats an empty query as match-everything", () => {
    expect(planSearch("   ")).toEqual({ kind: "all" });
  });

  it("refuses to treat a pattern-looking query as a regex", () => {
    // Someone typing * or $ gets a prefix match on the literal text, never a
    // pattern of their own construction.
    expect(planSearch("a*").kind).toBe("prefix");
    expect(planSearch("$where").kind).toBe("prefix");
  });

  it("caps the query length so an enormous body cannot reach the matcher", () => {
    const plan = planSearch("x".repeat(5000));
    expect(plan.kind).toBe("text");
    expect("term" in plan ? plan.term.length : 0).toBe(200);
  });

  it("builds a $text match when the plan is text", () => {
    const filter = buildMatchFilter(planSearch("json"), { is_deprecated: false });
    expect(filter).toEqual({ is_deprecated: false, $text: { $search: "json" } });
  });

  it("builds an escaped anchored regex when the plan is a prefix", () => {
    const filter = buildMatchFilter(planSearch("a*"), { is_deprecated: false });
    const re = (filter.name as { $regex: string }).$regex;
    expect(re.startsWith("^")).toBe(true);
    expect(re).toContain("\\*"); // the asterisk is escaped, not a wildcard
  });

  it("adds no matcher at all for an empty query", () => {
    const filter = buildMatchFilter(planSearch(""), { is_deprecated: false });
    expect(filter.$text).toBeUndefined();
    expect(filter.name).toBeUndefined();
  });
});

describe("sortDirection", () => {
  it("defaults to ascending", () => {
    expect(sortDirection(null)).toBe(1);
    expect(sortDirection("asc")).toBe(1);
    expect(sortDirection("nonsense")).toBe(1);
  });

  it("honours desc, case-insensitively", () => {
    expect(sortDirection("desc")).toBe(-1);
    expect(sortDirection("DESC")).toBe(-1);
  });
});
