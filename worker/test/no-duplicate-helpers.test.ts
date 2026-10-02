import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Defect D73 — the same helper defined twice, in two modules.
 *
 * `namespaces.ts` carried private copies of `readBody` and `findUser` while also
 * being able to import them from `./namespaces-shared`, which `packages.ts` and
 * `ratings.ts` already used. Nothing imported them, so the duplication was
 * invisible: typecheck passed, lint passed, 337 tests passed.
 *
 * That is the exact shape of D68, where a local `contains(list, id)` was called as
 * `contains(viewer?._id, n.admins)` and every namespace-admin flag read `false` for
 * every user, forever. The signature sat a few lines below the use, so the page
 * where the mistake was made looked entirely normal.
 *
 * The two `findUser` copies had already drifted: the shared one rejects an empty
 * `uuid` before querying and asks for `_id` explicitly, the private one did
 * neither. Benign at the time — Mongo includes `_id` in an inclusion projection by
 * default — but the drift is the point. Two copies, one of which nobody reads.
 *
 * This test asserts no helper name is declared twice across `src/`. It is
 * deliberately strict: the cost of a false positive is deleting a duplicate or
 * renaming one, and the cost of a miss is another D68.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs));
    } else if (/\.(ts|js)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(abs);
    }
  }
  return out;
}

describe("no helper is defined in two places (D73)", () => {
  const files = sourceFiles(SRC);

  const byName = new Map<string, string[]>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
    for (const m of src.matchAll(re)) {
      const name = m[1]!;
      const list = byName.get(name) ?? [];
      list.push(file.slice(SRC.length + 1));
      byName.set(name, list);
    }
  }

  it("declares every top-level function name exactly once", () => {
    const dupes = [...byName.entries()]
      .filter(([, where]) => where.length > 1)
      .map(([name, where]) => `${name}: ${where.join(", ")}`);

    expect(
      dupes,
      "These helpers are declared more than once in src/.\n" +
        "  Two copies is how D68 shipped: a local helper called with its arguments\n" +
        "  swapped, reading false for every user, while every other check passed.\n" +
        "  Delete one, or import the shared one. If a name is genuinely a different\n" +
        "  thing, rename it rather than leaving both to drift.",
    ).toEqual([]);
  });

  it("actually inspected a meaningful number of files", () => {
    // Guards against the scan quietly matching nothing, which is the usual way a
    // source-scanning test rots into a no-op that always passes.
    expect(files.length).toBeGreaterThan(20);
    expect(byName.size).toBeGreaterThan(50);
  });

  it("routes/namespaces.ts uses the shared helpers", () => {
    const src = readFileSync(join(SRC, "routes/namespaces.ts"), "utf8");
    expect(src).toMatch(/import \{[^}]*\breadBody\b[^}]*\} from "\.\/namespaces-shared"/);
    expect(src).toMatch(/import \{[^}]*\bfindUser\b[^}]*\} from "\.\/namespaces-shared"/);
    // And defines neither itself.
    expect(src).not.toMatch(/^(?:async )?function\s+readBody\b/m);
    expect(src).not.toMatch(/^(?:async )?function\s+findUser\b/m);
  });
});