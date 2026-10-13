#!/usr/bin/env bash
#
# Direct-API smoke test for the FPM registry.
#
# This is docs/MANUAL_TESTING.md §2 ("post-deploy smoke") as a runnable script.
# It exercises every cheap, read-only surface with plain `curl` and asserts the
# one rule that matters:
#
#     success = HTTP 2xx AND JSON body `code: 200`
#     failure = HTTP non-2xx AND body `{ code, message }`
#
# It never publishes, deletes, or otherwise mutates state, so it is safe to run
# against production. Run it immediately after routing traffic to a new version
# and before raising the canary weight; a non-zero exit means roll back.
#
# Usage:
#     scripts/smoke.sh [https://registry.example.org]
#     API=https://registry.example.org scripts/smoke.sh
#     ALLOWED_ORIGIN=https://registry.example.org scripts/smoke.sh
#
# Env:
#     API             Base URL (default http://127.0.0.1:8787).
#     ALLOWED_ORIGIN  A known-good browser origin; enables the CORS echo check.
#     ALLOW_DEGRADED  1 => a reachable edge with an unreachable MongoDB is a
#                     warning, not a failure (useful against a local dev DB).
#
# Exit: 0 if every check passed, 1 otherwise.

set -uo pipefail

API="${1:-${API:-http://127.0.0.1:8787}}"
API="${API%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "smoke: curl is required" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "smoke: jq is required" >&2
  exit 2
fi

if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; DIM=''; RESET=''
fi

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); printf '  %sok%s   %s\n' "$GREEN" "$RESET" "$1"; }
fail() {
  FAIL=$((FAIL + 1))
  printf '  %sFAIL%s %s\n' "$RED" "$RESET" "$1"
  [[ -n "${2:-}" ]] && printf '       %s\n' "$DIM$2$RESET"
}
warn() { WARN=$((WARN + 1)); printf '  %swarn%s %s\n' "$YELLOW" "$RESET" "$1"; }

# ── request helper ───────────────────────────────────────────────────────────
# http METHOD PATH [curl args...] -> sets STATUS and BODY
STATUS=""
BODY=""
http() {
  local method="$1" path="$2"; shift 2
  local out
  if ! out="$(curl -sS -X "$method" -w $'\n%{http_code}' "$API$path" "$@")"; then
    STATUS="000"; BODY=""; return 0
  fi
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

# want_status EXPECTED LABEL
want_status() {
  if [[ "$STATUS" != "$1" ]]; then
    fail "$2" "HTTP $STATUS (want $1)${BODY:+: $BODY}"
    return 1
  fi
  return 0
}

# want_code EXPECTED LABEL
want_code() {
  local got
  got="$(jq -r '.code // empty' <<<"$BODY" 2>/dev/null)"
  if [[ "$got" != "$1" ]]; then
    fail "$2" "body.code='${got:-<none>}' (want $1)${BODY:+: $BODY}"
    return 1
  fi
  return 0
}

# want_ok LABEL -> HTTP 200 and body.code 200
want_ok() {
  want_status 200 "$1" || return 1
  want_code 200 "$1" || return 1
  pass "$1 (HTTP 200, code 200)"
}

printf '\nsmoke: %s\n' "$API"

# ── 2.1 Liveness and database reachability ───────────────────────────────────
http GET /health
if want_status 200 "/health reachable"; then
  if want_code 200 "/health envelope"; then
    hstatus="$(jq -r '.status // empty' <<<"$BODY")"
    connected="$(jq -r '.mongo.connected // false' <<<"$BODY")"
    if [[ "$connected" == "true" ]]; then
      pass "mongo connected (serverVersion $(jq -r '.mongo.serverVersion // "?"' <<<"$BODY"))"
    elif [[ "${ALLOW_DEGRADED:-0}" == "1" ]]; then
      warn "mongo NOT connected (status=$hstatus); allowed by ALLOW_DEGRADED=1"
    else
      fail "mongo NOT connected (status=$hstatus)" "read .mongo.connected, not the HTTP status; see MANUAL_TESTING.md §2.1"
    fi
    if [[ "$hstatus" != "healthy" && "$hstatus" != "degraded" ]]; then
      fail "/health status is '$hstatus' (want healthy or degraded)"
    fi
  fi
fi

# ── 2.3 Docs endpoints ───────────────────────────────────────────────────────
http GET /
if want_ok "GET /"; then
  if [[ "$(jq -r '.message // empty' <<<"$BODY")" != "fpm registry api" ]]; then
    fail "GET / message" "$BODY"
  fi
fi

# NOTE: /apidocs and /apidocs/openapi.json are bare documents, NOT envelopes —
# they carry no `code` field, so only the transport status is asserted here.
http GET /apidocs
want_status 200 "GET /apidocs"

http GET /apidocs/openapi.json
if want_status 200 "GET /apidocs/openapi.json"; then
  if jq -e '(.openapi|type=="string") and (.paths|type=="object")' >/dev/null 2>&1 <<<"$BODY"; then
    paths="$(jq -r '.paths | length' <<<"$BODY")"
    if [[ "$paths" =~ ^[0-9]+$ ]] && (( paths > 0 )); then
      pass "openapi has $paths paths"
    else
      fail "openapi path count is '$paths' (want > 0)" "the route table is 40+ routes; a drop means the generator broke"
    fi
  else
    fail "openapi document shape" "$BODY"
  fi
fi

# ── 2.2 Read path ────────────────────────────────────────────────────────────
http GET "/packages?query=fortran&page=0"
if want_ok "GET /packages (search)"; then
  jQuery='(.packages|type=="array") and (.total_pages|type=="number")'
  if jq -e "$jQuery" >/dev/null 2>&1 <<<"$BODY"; then
    pass "search shape (packages[], total_pages)"
  else
    fail "search shape" "$BODY"
  fi
fi

# ── 2.5 Artifact path (optional; only if a package is named) ─────────────────
if [[ -n "${TARBALL_PATH:-}" ]]; then
  http GET "$TARBALL_PATH"
  if want_status 200 "GET $TARBALL_PATH"; then
    pass "tarball served"
  fi
fi

# ── 2.6 / 2.7 Edge cache + rate-limit headers ────────────────────────────────
HDRS="$(curl -sS -D - -o /dev/null "$API/packages?query=fortran" 2>/dev/null)"
if grep -qi '^x-ratelimit-limit:' <<<"$HDRS"; then
  pass "rate-limit headers present ($(grep -i '^x-ratelimit-limit:' <<<"$HDRS" | tr -d '\r'))"
else
  fail "rate-limit headers absent" "the limiter failed open (counter store unreachable); see MANUAL_TESTING.md §7.1"
fi
if grep -qi '^x-cache:' <<<"$HDRS"; then
  pass "edge cache header present ($(grep -i '^x-cache:' <<<"$HDRS" | tr -d '\r'))"
else
  warn "no x-cache header (KV binding may be missing in this env)"
fi

# ── 2.4 CORS fails closed ────────────────────────────────────────────────────
EVIL="$(curl -sS -D - -o /dev/null -H 'Origin: https://evil.example' "$API/packages" 2>/dev/null)"
if grep -qi '^access-control-allow-origin:' <<<"$EVIL"; then
  fail "CORS reflects an unknown origin" "security regression; must fail closed (MANUAL_TESTING.md §2.4)"
else
  pass "CORS fails closed for an unknown origin"
fi
if [[ -n "${ALLOWED_ORIGIN:-}" ]]; then
  GOOD="$(curl -sS -D - -o /dev/null -H "Origin: $ALLOWED_ORIGIN" "$API/packages" 2>/dev/null)"
  if grep -qi "^access-control-allow-origin: *$ALLOWED_ORIGIN" <<<"$GOOD"; then
    pass "CORS echoes the allowed origin"
  else
    fail "CORS did not echo $ALLOWED_ORIGIN" "$GOOD"
  fi
else
  warn "CORS allowed-origin echo skipped (set ALLOWED_ORIGIN to enable)"
fi

# ── Tarball storage usage (free-tier signal) ─────────────────────────────────
http GET /tarballs/usage
if want_ok "GET /tarballs/usage"; then
  if jq -e 'has("objects") and has("bytes") and has("limit_bytes")' >/dev/null 2>&1 <<<"$BODY"; then
    pass "usage shape (objects, bytes, limit_bytes)"
  else
    fail "usage shape" "$BODY"
  fi
fi

# ── Unknown route is a shaped 404 ────────────────────────────────────────────
http GET "/definitely-not-a-route-$$"
if want_status 404 "GET /unknown -> 404"; then
  if want_code 404 "unknown-route envelope"; then
    pass "unknown route is a shaped 404"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n%s%d passed, %d failed, %d warning(s)%s\n' \
  "$([[ $FAIL -eq 0 ]] && printf '%s' "$GREEN" || printf '%s' "$RED")" \
  "$PASS" "$FAIL" "$WARN" "$RESET"

if (( FAIL > 0 )); then
  printf '%sROLLBACK SIGNAL: smoke failed.%s See docs/MANUAL_TESTING.md §8.\n' "$RED" "$RESET"
  exit 1
fi
printf '%sSmoke clean.%s Raise the canary weight.\n' "$GREEN" "$RESET"
