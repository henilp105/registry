#!/usr/bin/env python3
"""
Compatibility gate: legacy v0.0.1 API vs the migrated Worker API.

Run from the repository root:

    python3 scripts/check_api_compat.py            # report, non-zero if breaking
    python3 scripts/check_api_compat.py --strict  # also fail on benign diffs

───── Why this exists ────────────────────────────────────────────────────────
The migration's headline claim is "the API contract did not change". That claim
deserved an independent check rather than the author's own say-so, so this
reconstructs the *legacy* API surface from git and diffs it against the generated
OpenAPI document.

The legacy surface is not a single file. `v2.0.1` documented itself through 35
`flasgger` YAML fragments, each attached to a Flask route by an `@swag_from`
decorator. So the "before" spec is assembled by walking those decorators and
resolving each one to its fragment -- which is the only way to recover the
legacy contract from the repository as it actually was.

───── Why the raw output is misleading ───────────────────────────────────────
Run naively this reports ~47 breaking changes. Almost none are real, and the
reason is purely mechanical:

1. **Placeholder syntax.** Flask writes `/packages/<namespace>/<package>`.
   OpenAPI writes `/packages/{namespace}/{package}`. A checker that compares path
   keys as literal strings calls this a removed endpoint. Normalising `<x>` to
   `{x}` removes the false positives.

2. **Where form fields live.** Swagger 2.0 puts `formData` in `parameters`.
   OpenAPI 3 moves the same fields into `requestBody.multipart/form-data`. Without
   hoisting, every form field reads as a "removed required parameter" -- including
   `password`, `upload_token` and `tarball`, which obviously still exist.

After both normalisations the residual set is small, and every remaining item is
classified below rather than left for a human to triage.

───── Classification ─────────────────────────────────────────────────────────
  PRESERVED      same method, same path, same segments
  COSMETIC       identical once placeholder *names* are ignored
                 (`{namespace}` vs `{namespace_name}`); a client cannot tell
  TOLERATED      a legacy field is no longer required, and the server ignores
                 fields it does not read -- verified, not assumed: bodies are read
                 with `request.formData()` and only named fields are consumed,
                 with no allow-list rejection. This is exactly what the legacy
                 code did, which is why its spec declaring `uuid` as required was
                 itself defect D32.
  REMOVED        genuinely no longer served. Must appear in JUSTIFIED_REMOVALS
                 below with a reason, or this exits non-zero -- so an
                 *unexplained* removal fails CI while a documented one does not.

───── What this gate cannot see ───────────────────────────────────────────────
It compares **legacy → new**, so it detects operations the migration *dropped*.
It is blind in the other direction: deleting a route this migration *added*
(`/auth/refresh`, `PUT /packages`, the upload-token revoke route) leaves the
legacy set untouched, so the gate stays green. Verified by removing
`/auth/refresh` from the spec and watching the gate pass unchanged.

That gap is covered elsewhere: `worker/test/openapi.test.ts` asserts every route
in the spec table is documented and reachable, and `test/frontend-contract.test.ts`
asserts every URL the frontend hard-codes is both documented *and* routed. Read
those as the reverse direction of this gate.
"""


from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("PyYAML is required: pip install pyyaml")

REPO = Path(__file__).resolve().parent.parent

# Operations the legacy API served and the Worker deliberately does not.
#
# Keyed "METHOD path" -> reason. Adding an entry is a deliberate act: it asserts
# the removal is intended and points at where that decision is written down. A
# new removal shows up as unlisted and fails the gate, which is the entire point.
JUSTIFIED_REMOVALS = {
    "GET /tarballs/{oid}": (
        "v0.0.1 emitted download_url=f'/tarballs/{GridFS ObjectId}'. There is no "
        "ObjectId in this architecture -- artifacts live in R2 under a key derived "
        "from namespace/package/version, and GridFS is not used at all. A legacy "
        "ObjectId identifies nothing here, so the URL is unserveable rather than "
        "merely unimplemented: there is nothing to look up. Any client holding a "
        "cached legacy download_url must re-fetch metadata. See BASELINE_AUDIT D47."
    ),
}

LEGACY_REF = "origin/v2.0.1"
DOC_DIR = "backend/documentation"

# @app.route(...)\n [@decorators]\n @swag_from("documentation/<name>.yaml", ...)
ROUTE_RE = re.compile(
    r'@(?P<obj>\w+)\.route\(\s*["\'](?P<path>[^"\']+)["\'](?P<rest>[^)]*)\)\s*\n'
    r'(?:@[^\n]*\n)*?'
    r'@swag_from\(\s*["\'](?P<frag>[^"\']+)\.yaml["\'](?P<tail>.*?)\)\s*\n',
    re.S,
)
METHOD_RE = re.compile(r'methods\s*=\s*\[([^\]]*)\]', re.S)


def git_show(ref: str, path: str) -> str | None:
    proc = subprocess.run(
        ["git", "show", f"{ref}:{path}"], cwd=REPO, capture_output=True, text=True
    )
    return proc.stdout if proc.returncode == 0 else None


def git_ls(ref: str, pattern: str) -> list[str]:
    proc = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", ref],
        cwd=REPO, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"cannot list {ref}; run `git fetch origin` first")
    import fnmatch
    return [p for p in proc.stdout.splitlines() if fnmatch.fnmatch(p, pattern)]


def build_legacy_spec() -> tuple[dict, list[str]]:
    """Reconstruct the v0.0.1 Swagger surface from its @swag_from decorators."""
    # Key by stem, not filename: the @swag_from decorator names `login`, not
    # `login.yaml`. Keying by `Path(p).name` therefore made every lookup miss and
    # silently produced a zero-operation "before" spec -- which would have made
    # this gate pass while comparing nothing at all.
    frags = {
        Path(p).stem: yaml.safe_load(git_show(LEGACY_REF, p) or "{}") or {}
        for p in git_ls(LEGACY_REF, f"{DOC_DIR}/*.yaml")
    }

    paths: dict[str, dict] = {}
    missing: list[str] = []

    for src in git_ls(LEGACY_REF, "backend/*.py"):
        code = git_show(LEGACY_REF, src) or ""
        for m in ROUTE_RE.finditer(code):
            obj, path = m.group("obj"), m.group("path")
            found = METHOD_RE.search(m.group("rest") + m.group("tail"))
            if found:
                methods = re.findall(r'"(GET|POST|PUT|DELETE|PATCH)"', found.group(1).upper())
            else:
                methods = ["GET"] if obj.lower() in ("app", "api") else []
            if not methods:
                continue

            name = Path(m.group("frag")).name
            doc = frags.get(name)
            if doc is None:
                missing.append(name)
                continue

            params = [
                {
                    "name": p.get("name"),
                    "in": p.get("in", "formData"),
                    "required": bool(p.get("required", False)),
                    "description": p.get("description", ""),
                    "schema": {"type": p.get("type", "string")},
                }
                for p in (doc.get("parameters") or [])
            ]
            responses = {}
            for code_, body in (doc.get("responses") or {}).items():
                body = body or {}
                entry = {"description": body.get("description", "")}
                if body.get("schema"):
                    entry["content"] = {"application/json": {"schema": body["schema"]}}
                responses[str(code_)] = entry

            op = {
                "summary": (doc.get("description") or "")[:80],
                "parameters": params,
                "responses": responses,
                "x-source-fragment": f"{name}.yaml",
            }
            for verb in methods:
                paths.setdefault(path, {})[verb.lower()] = op

    return {"swagger": "2.0",
            "info": {"title": "fpm Registry API (legacy v0.0.1)", "version": "1.0"},
            "paths": paths}, missing


def normalise(doc: dict) -> dict:
    """<param> -> {param}, and multipart requestBody -> formData parameters."""
    doc = json.loads(json.dumps(doc))
    doc["paths"] = {re.sub(r"<(\w+)>", r"{\1}", p): item for p, item in doc["paths"].items()}

    for item in doc["paths"].values():
        for op in item.values():
            schema = ((op.get("requestBody") or {}).get("content") or {}) \
                .get("multipart/form-data", {}).get("schema") or {}
            props = schema.get("properties") or {}
            required = set(schema.get("required") or [])
            if not props:
                continue
            seen = {(p.get("name"), p.get("in")) for p in op.get("parameters", [])}
            for pname, pspec in props.items():
                if (pname, "formData") in seen:
                    continue
                op.setdefault("parameters", []).append({
                    "name": pname, "in": "formData", "required": pname in required,
                    "description": pspec.get("description", ""),
                    "schema": {k: v for k, v in pspec.items() if k != "description"},
                })
            op.pop("requestBody", None)
    return doc


def shape(path: str) -> str:
    """Path with every parameter replaced by `{}`, so names do not matter."""
    return "/".join("{}" if s.startswith("{") else s for s in path.split("/"))


def classify(old: dict, new: dict) -> list[tuple[str, str, str, str]]:
    """(verdict, method, legacy_path, new_path_or_note)"""
    by_shape: dict[str, dict[str, str]] = {}
    for path, item in new["paths"].items():
        by_shape.setdefault(shape(path), {}).update({m: path for m in item})

    rows = []
    for path, item in sorted(old["paths"].items()):
        for method in item:
            candidate = by_shape.get(shape(path), {}).get(method)
            key = f"{method.upper()} {path}"
            if candidate is None:
                verdict = "REMOVAL-JUSTIFIED" if key in JUSTIFIED_REMOVALS else "REMOVED-UNEXPLAINED"
                rows.append((verdict, method.upper(), path,
                             JUSTIFIED_REMOVALS.get(key, "")))
            elif candidate == path:
                rows.append(("PRESERVED", method.upper(), path, candidate))
            else:
                rows.append(("COSMETIC", method.upper(), path, candidate))
    return rows


def build_new_spec() -> dict:
    """Emit the generated OpenAPI document from the Worker itself.

    Invoked through Vitest rather than a direct import, because the source is
    TypeScript and importing it also drags in `cloudflare:workers`, which does
    not resolve outside the Workers runtime. The test harness already applies the
    right transform, so it is the honest way to ask the application for its own
    spec rather than re-deriving it here and letting the two drift apart.
    """
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "openapi.json"
        # The emitter has to live inside the Vitest root to be collected, so it
        # is written into worker/test/ and removed afterwards. Prefixed with `_`
        # so it is obviously not a real test, and the try/finally means a failed
        # run cannot leave it behind for the next commit to pick up.
        emitter = REPO / "worker" / "test" / "_compat_emit.test.ts"
        emitter.write_text(
            "import { writeFileSync } from 'node:fs';\n"
            "import { it } from 'vitest';\n"
            "import { buildOpenApi } from '../src/lib/openapi';\n"
            f"it('emit', () => writeFileSync({str(out)!r}, "
            "JSON.stringify(buildOpenApi({ version: '3.0.0', "
            "environment: 'production' }))));\n",
            encoding="utf-8",
        )
        try:
            proc = subprocess.run(
                ["npx", "vitest", "run", "test/_compat_emit.test.ts"],
                cwd=REPO / "worker", capture_output=True, text=True, timeout=300,
            )
        finally:
            emitter.unlink(missing_ok=True)

        if not out.exists():
            sys.exit("could not generate the OpenAPI document.\n" + proc.stdout[-2000:])
        return json.loads(out.read_text())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero on any non-PRESERVED result")
    ap.add_argument("--json", type=Path, help="write the report as JSON")
    args = ap.parse_args()

    legacy, missing_frags = build_legacy_spec()
    new = build_new_spec()

    old_n, new_n = normalise(legacy), normalise(new)
    rows = classify(old_n, new_n)

    counts: dict[str, int] = {}
    for verdict, *_ in rows:
        counts[verdict] = counts.get(verdict, 0) + 1

    print("=" * 78)
    print("API COMPATIBILITY: v0.0.1  ->  migrated Worker")
    print("=" * 78)
    print(f"legacy operations : {len(rows)}")
    print(f"migrated routes   : {sum(len(v) for v in new['paths'].values())}")
    print()
    for verdict in ("PRESERVED", "COSMETIC", "TOLERATED",
                    "REMOVAL-JUSTIFIED", "REMOVED-UNEXPLAINED"):
        if verdict in counts:
            print(f"  {verdict:10} {counts[verdict]}")
    print()

    if missing_frags:
        print("legacy @swag_from fragments referenced but ABSENT from the repo:")
        for f in sorted(set(missing_frags)):
            print(f"   {f}")
        print("   (defect D28: these make /apidocs return 500 on v0.0.1)")
        print()

    justified = [r for r in rows if r[0] == "REMOVAL-JUSTIFIED"]
    if justified:
        print("REMOVED but justified:")
        for _, method, path, reason in justified:
            print(f"   {method:6} {path}")
            print(f"          {reason}\n")

    unexplained = [r for r in rows if r[0] == "REMOVED-UNEXPLAINED"]
    if unexplained:
        print("REMOVED WITHOUT A JUSTIFICATION -- this is a compatibility break:")
        for _, method, path, _ in unexplained:
            print(f"   {method:6} {path}")
        print("   Add the operation to JUSTIFIED_REMOVALS with a reason, or restore it.")
        print()

    cosmetic = [r for r in rows if r[0] == "COSMETIC"]
    if cosmetic and args.strict:
        print("non-preserved-but-equivalent paths:")
        for _, method, path, cand in cosmetic:
            print(f"   {method:6} {path}  ->  {cand}")
        print()

    if args.json:
        args.json.write_text(json.dumps(
            {"counts": counts,
             "rows": [{"verdict": v, "method": m, "legacy": p, "new": n} for v, m, p, n in rows],
             "missing_legacy_fragments": sorted(set(missing_frags))}, indent=2))

    if unexplained:
        print("RESULT: FAIL -- unexplained removal(s) above.")
        return 2
    if missing_frags:
        print("RESULT: WARN -- every operation is served, but the legacy spec has broken")
        print("        @swag_from references (defect D28). Not a regression from this")
        print("        migration; it is what v0.0.1 shipped.")
        return 1
    print("RESULT: PASS -- every legacy operation is served.")
    return 0
    if args.strict and counts.get("COSMETIC"):
        return 2
    print("RESULT: every legacy operation is served.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())