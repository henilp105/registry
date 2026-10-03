#!/usr/bin/env node
/**
 * Redux session and reducer-shape assertions.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `scripts/check_store_helpers.mjs` covers the four pure helpers in
 * `store/utils`. This covers the *reducer graph*, and it exists for one reason:
 *
 * **Defect D97** — only `auth` was cleared on logout. Every other slice survived
 * in memory, and `logout()` navigates without a page reload, so signing in as a
 * different account in the same tab showed user B the previous account's
 * packages, namespaces and role chips under a greeting addressed to B. That is
 * a cross-account data disclosure.
 *
 * The class of bug is "a field is written but never read" or "a field is read
 * but nobody writes it". Neither shows up in typecheck (the store is plain
 * objects), nor in `react-scripts build`, nor in review, because every individual
 * line is correct. The frontend has no test runner, and adding one for a
 * reducer graph would be a large dependency decision — so the real reducers are
 * imported and driven here, exactly as `check_store_helpers.mjs` does.
 *
 * Note the constraints this inherits: the reducers are plain functions with no
 * `react-redux` and no browser dependency, which is what makes this possible at
 * all. Anything that stops being true should move this into a real test runner
 * rather than being worked around here.
 */

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const reducersDir = join(repoRoot, "frontend", "src", "store", "reducers");

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ── D97: logging out must wipe every account-scoped slice ─────────────────────

console.log("session reset — signing out must not leave the previous account in memory\n");

/**
 * Transpile the reducer on the fly.
 *
 * The reducers are ESM with JSX-free but type-annotated exports (`Foo | null`),
 * which plain `node` cannot import. Rewriting the type annotations is
 * mechanical and local; a regex over a dozen small files is cheaper than adding
 * a TS toolchain to the repo for this one check.
 */
const { transform } = await import(
  join(repoRoot, "frontend", "node_modules", "@babel", "core", "lib", "index.js")
);
const tsPlugin = join(
  repoRoot, "frontend", "node_modules", "@babel", "plugin-transform-typescript",
);

/**
 * Compile every reducer into one temp directory as ESM, and load them.
 *
 * Two wrinkles worth stating, because both are loaders rather than audit logic:
 *
 *   1. The sources use JSX-free but type-annotated exports (`Foo | null`), which
 *      plain `node` cannot parse. Babel strips the types; the regex alternative
 *      was rejected because it would have to understand annotations in twelve
 *      files to check a behaviour in one.
 *   2. The sources use **extensionless** relative imports (`./authReducer`),
 *      which is legal for webpack and illegal for ESM. Rewriting each specifier
 *      to `./authReducer.mjs` is the whole fix, and it has to happen for every
 *      reducer at once since they import each other.
 *
 * Babel is imported by absolute path: it is a transitive dependency of
 * react-scripts, so a bare specifier would resolve against the repo root, which
 * has no node_modules. CI runs this from the root.
 */
/**
 * Compile the whole `store/` tree, preserving its layout, into a scratch dir.
 *
 * The scratch directory goes **inside `frontend/node_modules/.cache/`**, and
 * that placement is load-bearing rather than tidiness: Node resolves bare
 * specifiers by walking *up* from the importing file, so only from there does
 * `import { post } from "../utils"` find `frontend/node_modules/axios` by the
 * time `utils/index.js` → `apiClient.js` needs it. A `/tmp` scratch dir gets as
 * far as the actions' imports and then fails on `axios` — which is why this
 * started in `/tmp` and had to move.
 *
 * `node_modules` is gitignored, so nothing here can be committed by accident,
 * and the directory is removed in a `finally` either way.
 */
mkdirSync(join(repoRoot, "frontend", "node_modules", ".cache"), { recursive: true });
const outDir = mkdtempSync(join(repoRoot, "frontend", "node_modules", ".cache", "registry-reducers-"));

/**
 * Extensionless relative specifiers are legal for webpack and illegal for ESM,
 * so every one is rewritten. Resolved against the filesystem rather than
 * pattern-matched, because `../utils` names a *directory* and has to become
 * `../utils/index.mjs`.
 *
 * Two passes, and the second is not optional: pass one has to write *every*
 * output file before any of them is rewritten, because `reducers/authReducer.js`
 * imports `../actions/authActions` and the actions are written after it. Doing
 * the rewrite inline resolves against a partially-populated tree and produces a
 * specifier node cannot follow.
 */
const compiled = [];

function compileTree(srcDir, outTarget) {
  mkdirSync(outTarget, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const from = join(srcDir, entry.name);
    const to = join(outTarget, entry.name);
    if (entry.isDirectory()) {
      compileTree(from, to);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;

    const source = readFileSync(from, "utf8");
    const { code } = transform(source, {
      filename: entry.name,
      plugins: [tsPlugin],
      babelrc: false,
      configFile: false,
    });
    const outFile = join(outTarget, `${entry.name.slice(0, -3)}.mjs`);
    writeFileSync(outFile, code);
    compiled.push(outFile);
  }
}

function rewriteSpecifiers() {
  for (const outFile of compiled) {
    const code = readFileSync(outFile, "utf8").replace(
      // Both quote styles, because Babel preserves whichever the source used.
      // `utils/index.js` re-exports with single quotes, so a double-quote-only
      // pattern silently skipped it and the failure surfaced as a missing
      // `apiClient` two directories away.
      /from\s+(['"])(\.[^'"]*?)\1/g,
      (_m, quote, spec) => {
        const dir = dirname(outFile);
        if (existsSync(join(dir, `${spec}.mjs`))) return `from ${quote}${spec}.mjs${quote}`;
        if (existsSync(join(dir, spec, "index.mjs"))) return `from ${quote}${spec}/index.mjs${quote}`;
        // Unresolvable: leave it, so node names the real missing module rather
        // than reporting a guessed rewrite.
        return _m;
      },
    );
    writeFileSync(outFile, code);
  }
}

compileTree(join(repoRoot, "frontend", "src", "store"), outDir);
rewriteSpecifiers();

const load = (spec) =>
  import(`file://${join(outDir, spec)}`).then((m) => m.default ?? m);

/**
 * A state where every slice holds a recognisable value, so a leak is visible.
 *
 * Built from the reducers' *own* initial states rather than a literal, so this
 * keeps working when a slice is added or a field renamed. If a slice genuinely
 * initialises to `null`, it is seeded with a sentinel instead — the point is
 * that no slice ends the logout holding the previous account's data.
 */
function seedState(reducers) {
  const state = {};
  for (const [key, reducer] of Object.entries(reducers)) {
    const initial = reducer(undefined, { type: "@@probe" });
    if (initial && typeof initial === "object" && !Array.isArray(initial)) {
      state[key] = Object.fromEntries(
        Object.keys(initial).map((field) => {
          const v = initial[field];
          if (v === null || v === undefined) return [field, `LEAKED-${key}-${field}`];
          if (typeof v === "object") return [field, { marker: `LEAKED-${key}-${field}` }];
          return [field, `LEAKED-${key}-${field}`];
        }),
      );
    } else {
      state[key] = `LEAKED-${key}`;
    }
  }
  return state;
}

/**
 * Discover each slice's reducer *module* from the root reducer's source, so a
 * slice added later is covered without editing this file.
 *
 * Two facts about the real file make the obvious approach wrong:
 *
 *   - The import alias is often not the module name.
 *     `addRemoveNamespaceMaintainer: addRemoveNamespaceMaintainerReducer` is
 *     imported from `./namespaceMaintainersReducer`. Loading
 *     `reducers/addRemoveNamespaceMaintainerReducer.mjs` is a file that does not
 *     exist.
 *   - So the alias is resolved to its module through the import statement, and
 *     the slice map through the object literal.
 */
const rootSource = readFileSync(join(reducersDir, "rootReducer.js"), "utf8");

const aliasToModule = new Map(
  [...rootSource.matchAll(/import\s+(\w+)\s+from\s+["']\.\/([\w-]+)["']/g)].map((m) => [
    m[1],
    m[2],
  ]),
);

const sliceModules = new Map(
  [...rootSource.matchAll(/^\s{2}(\w+):\s*(\w+),$/gm)].map((m) => {
    const module = aliasToModule.get(m[2]);
    assert(module, `slice "${m[1]}" uses ${m[2]}, which rootReducer.js does not import`);
    return [m[1], module];
  }),
);

const sliceNames = [...sliceModules.keys()];

const sliceReducers = {};
for (const [slice, module] of sliceModules) {
  sliceReducers[slice] = await load(`reducers/${module}.mjs`);
}

const rootReducer = await load("reducers/rootReducer.mjs");
const seeded = seedState(sliceReducers);
const afterLogout = rootReducer(seeded, { type: "LOGOUT_SUCCESS" });

/**
 * Slices whose contents are *not* account data.
 *
 * `auth` is absent deliberately: it is the slice the logout is *for*, and its
 * reducer clears the tokens itself. What this script must prove is that the other
 * three survive — `search` holds the visitor's query and sort, `archives` is
 * public registry content cached from an unauthenticated endpoint. Asserting
 * `auth` survived would be asserting the opposite of correct.
 */
const PRESERVED = new Set(["search", "archives"]);

check("every slice is present in the seeded state", () => {
  assert(
    sliceNames.length >= 15,
    `only found ${sliceNames.length} slices; the slice-name regex may have stopped matching`,
  );
});

for (const slice of sliceNames) {
  if (PRESERVED.has(slice)) {
    check(`${slice} is preserved across logout (public or visitor data)`, () => {
      assert(
        afterLogout[slice] !== undefined,
        `${slice} vanished from the state entirely`,
      );
      assert(
        JSON.stringify(afterLogout[slice]) === JSON.stringify(seeded[slice]),
        `${slice} was cleared but is on the preserve list — visitor-owned state would be lost on sign-in`,
      );
    });
  } else {
    check(`${slice} is wiped on logout`, () => {
      assert(
        JSON.stringify(afterLogout[slice]) !== JSON.stringify(seeded[slice]),
        `${slice} still holds the previous account's data after LOGOUT_SUCCESS (D97)`,
      );
      // And it must be back to the reducer's own initial state, not merely
      // "different" — otherwise a partial wipe leaves a hybrid.
      const initial = sliceReducers[slice](undefined, { type: "@@probe" });
      assert(
        JSON.stringify(afterLogout[slice]) === JSON.stringify(initial),
        `${slice} was reset to something other than its initial state`,
      );
    });
  }
}

check("auth itself is still handled by its own reducer on logout", () => {
  // The root reducer must not short-circuit the combined reducer: `auth` has to
  // run first, and only then may the other slices be reset. If someone made the
  // reset return early — or replaced the slice map with hard-coded initial
  // states — this catches it.
  //
  // `seeded.auth` is deliberately unusable here: it holds string sentinels, not
  // an auth shape, and combineReducers warns loudly about exactly that. This
  // builds a real one instead of reusing it.
  const signedIn = {
    ...seeded,
    auth: { ...sliceReducers.auth(undefined, { type: "@@probe" }), accessToken: "t", username: "someone" },
  };
  const out = rootReducer(signedIn, { type: "LOGOUT_SUCCESS" });
  assert(out.auth.accessToken === null, "auth.accessToken survived logout");
  assert(out.auth.username === null, "auth.username survived logout");
});

check("an unrelated action does not wipe the state", () => {
  const out = rootReducer(seeded, { type: "SOMETHING_ELSE" });
  assert(
    JSON.stringify(out.dashboard) === JSON.stringify(seeded.dashboard),
    "an unrelated action triggered the session reset",
  );
});

check("the reset does not fire before a state exists (redux INIT)", () => {
  // combineReducers calls the root with `undefined` state first. Returning a
  // reset state there would break initialisation.
  const out = rootReducer(undefined, { type: "@@redux/INIT" });
  assert(out && typeof out === "object", "root reducer produced nothing at init");
  assert(out.auth !== undefined, "auth slice missing at init");
});

rmSync(outDir, { recursive: true, force: true });

console.log(
  `\n${checks - failures}/${checks} checks passed`,
);
process.exit(failures === 0 ? 0 : 1);
