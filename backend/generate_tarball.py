"""
Produce a MongoDB archive for the registry.

Run from `backend/` by the `Registry Database Archive` workflow, and by hand with:

    MONGO_DB_NAME=fpmregistry MONGO_URI=... python generate_tarball.py

What the archive is for, and what it must never contain
-------------------------------------------------------
This is a **full database dump** minus the `users` collection. That exclusion is
the entire safety property of the file, and it is why the dump is a publishable
artefact at all: `users` holds password hashes, email addresses and account
uuids. Everything left is public registry content — namespaces, packages,
versions and their metadata.

Two defects this file previously had, both of which made it lie about whether it
had produced anything:

**Defect D121.** `subprocess.call()` *returns* the child's exit status; it never
raises `CalledProcessError`. That call was only ever raised by `check_call`. So
the `except` clause was unreachable, the exit code was discarded, and a `mongodump`
that failed — bad credentials, no mongodump binary, unreachable host — printed
"Database backup created successfully" and exited **0**. The workflow then
uploaded whatever was in `static/`, which on a failed run is the stale archive
from the previous one, and the step went green.

**Defect D123.** `mongo_username` and `mongo_password` were read from the
environment and never used: the URI carries the credentials. Worse, the module
then opened a `MongoClient` at import time and threw the object away. On a
deployment where those variables were unset, the `KeyError` handler printed a
message and **fell through**, leaving `mongo_uri` undefined and the dump command
built with `--uri=None`.

Defect D122 is in the workflow that calls this file, not here.
"""

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# `--excludeCollection=users` is not optional. It is the difference between a
# publishable archive and a credential dump, and it is asserted below rather than
# trusted to the string above.
EXCLUDED_COLLECTIONS = ("users",)

STATIC_DIR = Path(__file__).resolve().parent / "static"


def required_env(name: str) -> str:
    """Fetch a required variable, or exit with a message naming it.

    Defect D123: the old `try/except KeyError` printed "Add MONGO_URI to .env
    file" and carried on, which produced a command line containing `None` and a
    green build. A missing prerequisite must stop the run.
    """
    value = os.environ.get(name)
    if not value:
        print(f"error: {name} is not set. It is required to build the archive.", file=sys.stderr)
        sys.exit(1)
    return value


def generate_latest_tarball() -> Path:
    """Write `static/registry-<date>.tar.gz` and return its path.

    Raises RuntimeError if `mongodump` fails or produces nothing, so the caller
    cannot mistake a failed dump for a successful one.
    """
    database_name = required_env("MONGO_DB_NAME")
    mongo_uri = required_env("MONGO_URI")

    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    archive_date = datetime.now().strftime("%d-%m-%Y")
    archive_path = STATIC_DIR / f"registry-{archive_date}.tar.gz"

    command = [
        "mongodump",
        f"--uri={mongo_uri}",
        f"--archive={archive_path}",
        f"--db={database_name}",
        "--gzip",
    ]
    for collection in EXCLUDED_COLLECTIONS:
        command.append(f"--excludeCollection={collection}")

    # Defect D121: the return code is the result. It was discarded, the
    # `except CalledProcessError` was unreachable (`call` does not raise), and a
    # failed dump reported success and exited 0.
    #
    # `shell=False` throughout — the command is an argument vector, so there is
    # no shell to interpret a metacharacter in the URI or the database name. Same
    # reasoning as backend/validate.py (D87).
    print(f"  $ {' '.join(command)}")
    try:
        result = subprocess.run(command, text=True, capture_output=True)
    except FileNotFoundError:
        raise RuntimeError(
            "mongodump is not installed or not on PATH; the archive was not created"
        ) from None

    if result.returncode != 0:
        raise RuntimeError(
            f"mongodump exited {result.returncode}: {(result.stderr or result.stdout).strip()[:400]}"
        )

    # A zero exit with no file is still a failure, and mongodump can produce one
    # that is empty. Checking the artefact is what closes that.
    if not archive_path.exists() or archive_path.stat().st_size == 0:
        raise RuntimeError(f"mongodump reported success but {archive_path.name} is missing or empty")

    print(f"created {archive_path.name} ({archive_path.stat().st_size} bytes)")
    return archive_path


def main() -> int:
    try:
        path = generate_latest_tarball()
    except RuntimeError as err:
        # Non-zero, and the message goes to stderr where the workflow log shows it.
        print(f"error: {err}", file=sys.stderr)
        return 1
    print(f"Database backup created successfully: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
