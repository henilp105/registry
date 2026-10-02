import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Defect D68 — `isNamespaceAdmin` was always false.
 *
 * `src/routes/users.ts` computed the membership flags with a local helper
 * declared as `function contains(list, id)` and called it as
 * `contains(viewer?._id, n.admins)` — the arguments the wrong way round. `list`
 * was therefore a hex string, `Array.isArray` was false, and the function returned
 * false for everyone, always.
 *
 * Measured: the viewer `_id` and `n.admins[0]` were the same 24 hex characters,
 * `strId(a) === strId(b)` was true, and `contains(a, b)` still returned false.
 *
 * What that cost: `/users/{u}` reported no namespace-admin rights for anyone, so
 * the dashboard hid **every** namespace-admin action — Add/Remove Admin,
 * Add/Remove Maintainer, Generate Token. A namespace owner had no way to manage
 * their own namespace from the UI.
 *
 * The local duplicate has been deleted in favour of `containsId` from
 * `lib/permissions`, whose whole reason for existing is comparing ids across the
 * mixed ObjectId/string representations this codebase stores. These tests stop the
 * two mistakes that caused it coming back.
 */

const ROUTES_DIR = join(process.cwd(), "src/routes");
const routeFiles = readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts"));
const read = (f: string) => readFileSync(join(ROUTES_DIR, f), "utf8");

describe("membership flag helpers", () => {
  it("no route declares its own `contains` alongside the shared one", () => {
    // `lib/permissions` exports `containsId`. A route-local `contains` with the
    // same body is what allowed the swapped call to compile and pass review: the
    // signature was visible only a few lines away from the use.
    const offenders = routeFiles.filter((f) =>
      /function\s+contains\s*\(/.test(read(f)),
    );
    expect(
      offenders,
      "A route declares a local `contains`. Use `containsId` from lib/permissions: " +
        "a local copy is how the arguments got swapped in D68.",
    ).toEqual([]);
  });

  it("no membership check passes the id where the list belongs", () => {
    // The D68 shape, whatever the helper is called: `contains*(viewer…)`,
    // `contains*(user?._id…)`, `contains*(actor._id…)`. The first argument of a
    // membership helper is always the array.
    const offenders: string[] = [];
    for (const f of routeFiles) {
      const lines = read(f).split("\n");
      lines.forEach((line, i) => {
        if (!/contains(?:Id)?\s*\(/.test(line)) return;
        // Comments are skipped, and this test needs no exemption for its own
        // documentation: the D68 write-up quotes the broken call verbatim, and the
        // first version of this check flagged that comment and failed on clean code.
        // A scanner that cannot tell prose from code stops being read.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        const first = line.slice(line.indexOf("(") + 1).split(",")[0]?.trim() ?? "";
        // An identifier that is plainly a scalar id rather than a collection.
        if (/^(viewer|user|actor|self|auth)\b.*(_id|\?\._id|uuid)/.test(first)) {
          offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(
      offenders,
      "A membership helper is being called with an id first and a list second. " +
        "The signature is (list, id): swapping them silently returns false for " +
        "everyone (D68).",
    ).toEqual([]);
  });

  it("users.ts computes the flags with the shared helper", () => {
    const src = read("users.ts");
    expect(src).toMatch(/import \{[^}]*\bcontainsId\b[^}]*\} from "\.\.\/lib\/permissions"/s);
    expect(src).toContain("isNamespaceAdmin: containsId(");
    expect(src).toContain("isNamespaceMaintainer: containsId(");
    // And the list is genuinely first at both call sites.
    expect(src).not.toMatch(/containsId\(\s*(?:viewer|user|actor)\b/);
  });

  it("containsId normalises both representations, so order cannot be the only defence", async () => {
    // Belt and braces on the real helper: a hex string and the equivalent ObjectId
    // compare equal, an absent id never matches, and a non-array never matches.
    const { containsId } = await import("../src/lib/permissions");
    const HEX = "6abf30765c28fa0d62360ef6";

    expect(containsId([HEX], HEX)).toBe(true);
    expect(containsId([{ toHexString: () => HEX }], HEX)).toBe(true);
    expect(containsId([HEX.toUpperCase()], HEX)).toBe(true);
    expect(containsId([HEX], "6abf30765c28fa0d62360ef7")).toBe(false);
    expect(containsId([], HEX)).toBe(false);
    // The shape that D68 actually hit: a bare string where a list was expected.
    expect(containsId(HEX as never, HEX)).toBe(false);
    expect(containsId(undefined, HEX)).toBe(false);
  });
});