#!/usr/bin/env node
/**
 * Every react-bootstrap form field must be programmatically labelled.
 *
 * ── Defect D104 ─────────────────────────────────────────────────────────────
 * 17 `<Form.Group className="mb-3">` blocks across the admin page's five action
 * cards and all six maintainer/admin dialogs passed no `controlId`.
 * react-bootstrap renders `<Form.Group controlId="x">` as a label with
 * `htmlFor="x"` *and* puts `id="x"` on the child control. Without it you get a
 * bare `<label>` with no `for` and an input with no `id`, which means:
 *
 *   - the field has **no accessible name** — a screen reader announces only
 *     "edit text" / "combo box", so in the admin tools a moderator cannot tell
 *     which namespace or package they are about to delete;
 *   - clicking the visible label does not focus the control;
 *   - clicking the label does not select the text, which is the behaviour people
 *     expect from a form.
 *
 * This is the same class as the D104 fix in `resetpassword.js`, which its own
 * comment claimed was "the only form in the app with the omission". It was not.
 * That claim is the reason this check exists: an inventory written by reading
 * one file is an inventory of one file.
 *
 * ── Why a source scan and not a DOM assertion ────────────────────────────────
 * Rendering every page would need a test runner and a server, for a property
 * that is fully determined by the JSX. The rule is mechanical — `controlId` on
 * the group, or an explicit `id` on the control — so it is checked in the source,
 * and deliberately only in `src/`: a page under `build/` is output, not intent.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "frontend", "src");

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = jsFiles(srcDir).sort();

/**
 * Every `<Form.Group ...>` block, with its body.
 *
 * Splitting on the opening tag and pairing each with the next `</Form.Group>` is
 * enough here: these forms do not nest a `Form.Group` inside another, and a
 * proper parser for a property that only needs `controlId` would be a dependency.
 */
function formGroups(source) {
  const groups = [];
  const open = /<Form\.Group\b([^>]*)>/g;
  let m;
  while ((m = open.exec(source)) !== null) {
    const close = source.indexOf("</Form.Group>", m.index);
    if (close === -1) continue;
    groups.push({
      attrs: m[1],
      body: source.slice(m.index, close),
      index: m.index,
    });
    // Resume after the whole block, so a nested group cannot be double-counted.
    open.lastIndex = close;
  }
  return groups;
}

const labelled = [];
const unlabelled = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const group of formGroups(source)) {
    const line = source.slice(0, group.index).split("\n").length;
    const hasControlId = /\bcontrolId\s*=/.test(group.attrs);
    // An explicit `id` on the control is an equally valid association, so it is
    // accepted rather than demanded through react-bootstrap specifically.
    const hasExplicitId = /<(Form\.Control|Form\.Select)\b[^>]*\bid\s*=/s.test(group.body);
    const entry = { file: file.replace(`${join(here, "..")}/`, ""), line };

    if (hasControlId) labelled.push({ ...entry, how: "controlId" });
    else if (hasExplicitId) labelled.push({ ...entry, how: "explicit id" });
    else unlabelled.push(entry);
  }
}

console.log(
  `form labels — ${labelled.length} labelled, ${unlabelled.length} unlabelled across ${files.length} files\n`,
);

for (const l of labelled) {
  console.log(`  ok    ${l.file}:${l.line} (${l.how})`);
}

if (unlabelled.length > 0) {
  console.error(`\n${unlabelled.length} form field(s) with no accessible name:\n`);
  for (const u of unlabelled) console.error(`  ${u.file}:${u.line}`);
  console.error(
    '\nreact-bootstrap renders <Form.Group controlId="x"> as <label for="x"> plus\n' +
      'id="x" on the control. Without it the field has no accessible name at all,\n' +
      'and clicking the label does not focus it. Add controlId, or an explicit\n' +
      'id on the control.',
  );
  process.exit(1);
}

console.log("\nPASS  every form field is programmatically labelled");
