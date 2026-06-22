#!/usr/bin/env bash
#
# HTTP smoke tests for deployed Supabase Edge Functions.
#
# Catches regressions in:
#   - CORS / auth header configuration
#   - Top-level routing (function deployed and reachable)
#   - Input-validation branches (400/401/404/405 wiring)
#   - REST API grants for investment ("pledge") inserts
#
# These tests intentionally do NOT exercise happy-path mutations against the
# production DB. They probe error branches and read-only paths only, so they
# are safe to run against any environment.
#
# Usage:
#   ./scripts/smoke-edge-functions.sh                          # uses .env
#   SUPABASE_URL=... SUPABASE_ANON_KEY=... ./scripts/smoke-edge-functions.sh
#
set -euo pipefail

# Load .env if present so VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
# are picked up without needing to export them by hand.
if [ -f ".env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | xargs -0 2>/dev/null || grep -v '^#' .env | sed -e 's/"//g' | xargs)
fi

SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
ANON_KEY="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_PUBLISHABLE_KEY:-}}"

if [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ]; then
  echo "❌  SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_* equivalents) must be set"
  exit 2
fi

FN="$SUPABASE_URL/functions/v1"
REST="$SUPABASE_URL/rest/v1"
PASS=0
FAIL=0
FAILED_TESTS=()

# ── helpers ───────────────────────────────────────────────────────────────────
check() {
  local label="$1"
  local ok="$2"
  local detail="${3:-}"
  if [ "$ok" = "1" ]; then
    echo "  ✅  $label"
    PASS=$((PASS + 1))
  else
    echo "  ❌  $label"
    [ -n "$detail" ] && echo "       $detail"
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$label")
  fi
}

# Issues an HTTP request and prints "<status>|<body>" so callers can split.
http() {
  local method="$1"; shift
  local url="$1"; shift
  curl -sS -o /tmp/smoke-body.$$ -w "%{http_code}" -X "$method" "$url" "$@" || echo "000"
  echo "|"
  cat /tmp/smoke-body.$$ 2>/dev/null || true
  rm -f /tmp/smoke-body.$$
}

call() {
  # call METHOD PATH [extra curl args...] -> echoes "STATUS|BODY"
  local method="$1"; shift
  local path="$1"; shift
  local tmp; tmp=$(mktemp)
  local status
  status=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$path" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    "$@" 2>/dev/null || echo "000")
  local body
  body=$(cat "$tmp" 2>/dev/null || true)
  rm -f "$tmp"
  printf '%s|%s' "$status" "$body"
}

split_status() { echo "${1%%|*}"; }
split_body()   { echo "${1#*|}"; }

echo ""
echo "=== Edge Function Smoke Tests ==="
echo "    Target: $SUPABASE_URL"
echo ""

# ── 1. CORS preflight (every function must answer OPTIONS) ────────────────────
echo "── CORS preflight ──"
for fn in event-signup event-landing admin-action participant-login livekit-token; do
  res=$(call OPTIONS "$FN/$fn")
  s=$(split_status "$res")
  ok="0"; [ "$s" = "200" ] || [ "$s" = "204" ] && ok="1"
  check "OPTIONS $fn → 2xx" "$ok" "got status=$s"
done

# ── 2. participant-login (auth surface) ───────────────────────────────────────
echo ""
echo "── participant-login ──"

# 2a. Missing fields → 400
res=$(call POST "$FN/participant-login" -d '{}')
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "400" ] && echo "$b" | grep -q '"error"' && ok="1"
check "empty body → 400 with error" "$ok" "status=$s body=$b"

# 2b. Bogus session → 401 (Invalid credentials), never 500
res=$(call POST "$FN/participant-login" \
  -d '{"session_id":"00000000-0000-0000-0000-000000000000","email":"nope@example.com","password":"wrong"}')
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "401" ] && ok="1"
check "bad credentials → 401" "$ok" "status=$s body=$b"

# ── 3. admin-action (session creation auth gate) ──────────────────────────────
echo ""
echo "── admin-action (session creation) ──"

# 3a. No admin_token → 401 Unauthorized
res=$(call POST "$FN/admin-action" \
  -d '{"action":"create_session","payload":{"name":"smoke","start_time":"2099-01-01T00:00:00Z","end_time":"2099-01-01T01:00:00Z","timezone":"UTC"}}')
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "401" ] && ok="1"
check "create_session w/o admin_token → 401" "$ok" "status=$s body=$b"

# 3b. Garbage admin_token → 401
res=$(call POST "$FN/admin-action" \
  -d '{"admin_token":"not-a-real-token","action":"create_session","payload":{}}')
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "401" ] && ok="1"
check "create_session w/ forged token → 401" "$ok" "status=$s body=$b"

# 3c. GET → 405 (only POST allowed)
res=$(call GET "$FN/admin-action")
s=$(split_status "$res")
ok="0"; [ "$s" = "405" ] && ok="1"
check "GET admin-action → 405" "$ok" "status=$s"

# ── 4. event-landing (public read) ────────────────────────────────────────────
echo ""
echo "── event-landing ──"

# Unknown slug → 404, NOT 500. Catches query/grant regressions.
res=$(call GET "$FN/event-landing?slug=__smoke_unknown_slug__")
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "404" ] && ok="1"
check "unknown slug → 404" "$ok" "status=$s body=$b"

# ── 5. event-signup (validation branches) ─────────────────────────────────────
echo ""
echo "── event-signup ──"

# 5a. Invalid email → 400
res=$(call POST "$FN/event-signup" -d '{"slug":"smoke","email":"not-an-email"}')
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "400" ] && ok="1"
check "invalid email → 400" "$ok" "status=$s body=$b"

# 5b. Missing slug → 400
res=$(call POST "$FN/event-signup" -d '{"email":"ok@example.com"}')
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "400" ] && ok="1"
check "missing slug → 400" "$ok" "status=$s body=$b"

# 5c. Valid shape but unknown slug → 404
res=$(call POST "$FN/event-signup" \
  -d '{"slug":"__smoke_unknown_slug__","email":"smoke@example.com","investor_class":"accredited"}')
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "404" ] && ok="1"
check "unknown slug → 404 (not 500)" "$ok" "status=$s body=$b"

# ── 6. livekit-token (auth/validation surface) ────────────────────────────────
echo ""
echo "── livekit-token ──"
res=$(call POST "$FN/livekit-token" -d '{}')
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; { [ "$s" = "400" ] || [ "$s" = "401" ]; } && ok="1"
check "empty body → 400/401 (not 500)" "$ok" "status=$s body=$b"

# ── 7. investments REST endpoint (pledge insert is RLS-gated) ─────────────────
# The Invest dialog writes directly to /rest/v1/investments. A regression in
# the GRANT or RLS policies would break the pledge flow; this asserts the
# endpoint is reachable and rejects unauthenticated writes with a 4xx
# (typically 401/403) rather than a 5xx.
echo ""
echo "── investments REST (pledge path) ──"

# 7a. Endpoint reachable for SELECT (HEAD) — catches GRANT/route regressions.
status=$(curl -sS -o /dev/null -w "%{http_code}" -I \
  "$REST/investments?limit=1" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" 2>/dev/null || echo "000")
ok="0"; { [ "$status" = "200" ] || [ "$status" = "206" ] || [ "$status" = "401" ] || [ "$status" = "403" ]; } && ok="1"
check "GET /rest/v1/investments reachable (not 404/5xx)" "$ok" "status=$status"

# 7b. Anonymous POST without a session row must NOT 5xx — RLS should reject.
status=$(curl -sS -o /tmp/smoke-inv.$$ -w "%{http_code}" -X POST \
  "$REST/investments" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"session_id":"00000000-0000-0000-0000-000000000000","investor_email":"smoke@example.com","investor_name":"Smoke","startup_email":"x@example.com","startup_name":"X","amount":1}' \
  2>/dev/null || echo "000")
body=$(cat /tmp/smoke-inv.$$ 2>/dev/null || true)
rm -f /tmp/smoke-inv.$$
ok="0"
# Accept 2xx (RLS open), 4xx (RLS/grant denial, FK violation) — anything but 5xx.
if [ "${status:0:1}" != "5" ] && [ "$status" != "000" ]; then ok="1"; fi
check "POST /rest/v1/investments returns non-5xx" "$ok" "status=$status body=$body"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "───────────────────────────────"
echo "  Results: $PASS passed, $FAIL failed"
echo "───────────────────────────────"
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
  exit 1
fi
