#!/usr/bin/env bash
#
# Seeded HTTP smoke tests for deployed Edge Functions.
#
# Unlike scripts/smoke-edge-functions.sh (which only probes error branches),
# this script seeds real rows via the Supabase REST API using the SERVICE ROLE
# key, then exercises happy-path behaviors that depend on DB state:
#
#   1. event-signup CAP logic — fills max_attendees with approved investors
#      and confirms a new signup is rejected with "session is full" (409).
#   2. event-signup IDEMPOTENCY — same email signing up twice returns
#      already_registered=true instead of a 4xx duplicate-key error.
#   3. participant-login → admin_token → admin-action create_session —
#      verifies the auth handshake and the create_session write path.
#
# All seeded rows are cleaned up at the end (and on interrupt) so the script
# is safe to re-run repeatedly. Two unique slugs scoped to a random run id
# guarantee parallel runs don't collide.
#
# Requires:
#   SUPABASE_URL                 (or VITE_SUPABASE_URL in .env)
#   SUPABASE_ANON_KEY            (or VITE_SUPABASE_PUBLISHABLE_KEY)
#   SUPABASE_SERVICE_ROLE_KEY    (only this script needs it — for seeding)
#
# Usage:
#   SUPABASE_SERVICE_ROLE_KEY=... ./scripts/smoke-edge-functions-seeded.sh
#
set -euo pipefail

# ── 0. Config / env ───────────────────────────────────────────────────────────
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | sed -e 's/"//g' | xargs) >/dev/null 2>&1 || true
fi

SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
ANON_KEY="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_PUBLISHABLE_KEY:-}}"
SRK="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ]; then
  echo "❌  SUPABASE_URL and SUPABASE_ANON_KEY must be set" >&2
  exit 2
fi

# Seeding/cleanup uses one of two backends, in this priority order:
#   1. SUPABASE_SERVICE_ROLE_KEY → REST writes (works from any machine)
#   2. PGHOST/psql                → direct DB writes (used in CI sandboxes)
SEED_MODE=""
if [ -n "$SRK" ]; then
  SEED_MODE="rest"
elif [ -n "${PGHOST:-}" ] && command -v psql >/dev/null 2>&1; then
  SEED_MODE="psql"
else
  echo "❌  Need either SUPABASE_SERVICE_ROLE_KEY or PGHOST/psql to seed test data" >&2
  exit 2
fi
echo "    Seed mode: $SEED_MODE"

FN="$SUPABASE_URL/functions/v1"
REST="$SUPABASE_URL/rest/v1"

RUN_ID="smoke-$(date +%s)-$$"
FULL_SLUG="$RUN_ID-full"
OPEN_SLUG="$RUN_ID-open"
FAC_EMAIL="$RUN_ID-fac@smoke.test"
FAC_PASSWORD="smoke-pw-$$"
CREATED_SESSION_IDS=()  # tracks sessions to delete on exit

PASS=0
FAIL=0
FAILED_TESTS=()

# ── helpers ───────────────────────────────────────────────────────────────────
check() {
  local label="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "1" ]; then
    echo "  ✅  $label"; PASS=$((PASS + 1))
  else
    echo "  ❌  $label"
    [ -n "$detail" ] && echo "       $detail"
    FAIL=$((FAIL + 1)); FAILED_TESTS+=("$label")
  fi
}

# Service-role REST helper. Echoes "<status>|<body>".
srest() {
  local method="$1" path="$2"; shift 2
  local tmp; tmp=$(mktemp)
  local status
  status=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$REST$path" \
    -H "apikey: $SRK" \
    -H "Authorization: Bearer $SRK" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    "$@" 2>/dev/null || echo "000")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  printf '%s|%s' "$status" "$body"
}

# psql seeding helpers (used when SEED_MODE=psql). Bypass RLS via direct DB.
psql_scalar() { psql -tA -c "$1" 2>/dev/null | head -1 | tr -d '[:space:]'; }
psql_exec()   { psql -q -c "$1" >/dev/null 2>&1; }

# Unified seed/cleanup API — dispatches on $SEED_MODE so the same script runs
# whether the operator has the service-role key or local DB access.
seed_session() {
  # args: slug, max_attendees, name, start_iso, end_iso → echoes inserted id
  local slug="$1" cap="$2" name="$3" start="$4" end="$5"
  if [ "$SEED_MODE" = "rest" ]; then
    local res; res=$(srest POST "/sessions" \
      -d "{\"name\":\"$name\",\"slug\":\"$slug\",\"start_time\":\"$start\",\"end_time\":\"$end\",\"timezone\":\"UTC\",\"status\":\"scheduled\",\"max_attendees\":$cap}")
    [ "$(split_status "$res")" = "201" ] && json_str "$(split_body "$res")" "id"
  else
    psql_scalar "INSERT INTO public.sessions (name, slug, start_time, end_time, timezone, status, max_attendees) VALUES ('$name', '$slug', '$start'::timestamptz, '$end'::timestamptz, 'UTC', 'scheduled', $cap) RETURNING id"
  fi
}
seed_participant() {
  # args: session_id, email, role, approved(true/false), [password_hash]
  local sid="$1" email="$2" role="$3" approved="$4" pw="${5:-}"
  if [ "$SEED_MODE" = "rest" ]; then
    local payload
    if [ -n "$pw" ]; then
      payload="{\"session_id\":\"$sid\",\"email\":\"$email\",\"role\":\"$role\",\"approved\":$approved,\"password_hash\":\"$pw\"}"
    else
      payload="{\"session_id\":\"$sid\",\"email\":\"$email\",\"role\":\"$role\",\"approved\":$approved,\"investor_class\":\"accredited\"}"
    fi
    [ "$(split_status "$(srest POST "/session_participants" -d "$payload")")" = "201" ]
  else
    local pw_col="" pw_val=""
    if [ -n "$pw" ]; then pw_col=", password_hash"; pw_val=", '$pw'"; fi
    psql_exec "INSERT INTO public.session_participants (session_id, email, role, approved, investor_class$pw_col) VALUES ('$sid', '$email', '$role', $approved, 'accredited'$pw_val)"
  fi
}
delete_session_by_slug() {
  if [ "$SEED_MODE" = "rest" ]; then srest DELETE "/sessions?slug=eq.$1" >/dev/null
  else psql_exec "DELETE FROM public.sessions WHERE slug = '$1'"; fi
}
delete_session_by_id() {
  if [ "$SEED_MODE" = "rest" ]; then srest DELETE "/sessions?id=eq.$1" >/dev/null
  else psql_exec "DELETE FROM public.sessions WHERE id = '$1'"; fi
}
delete_participant_by_email() {
  if [ "$SEED_MODE" = "rest" ]; then srest DELETE "/session_participants?email=eq.$1" >/dev/null
  else psql_exec "DELETE FROM public.session_participants WHERE email = '$1'"; fi
}
session_has_name() {
  # args: session_id, expected_name → echoes 1 if found, 0 otherwise
  if [ "$SEED_MODE" = "rest" ]; then
    split_body "$(srest GET "/sessions?id=eq.$1&select=name")" | grep -q "$2" && echo 1 || echo 0
  else
    [ "$(psql_scalar "SELECT name FROM public.sessions WHERE id = '$1'")" = "$2" ] && echo 1 || echo 0
  fi
}

# Anon-key edge-function helper. Echoes "<status>|<body>".
efn() {
  local method="$1" path="$2"; shift 2
  local tmp; tmp=$(mktemp)
  local status
  status=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$FN$path" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    "$@" 2>/dev/null || echo "000")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  printf '%s|%s' "$status" "$body"
}

split_status() { echo "${1%%|*}"; }
split_body()   { echo "${1#*|}"; }

# Extracts a top-level JSON string field by name. Good enough for our shapes;
# avoids a hard dep on jq. Returns empty string when not found.
json_str() {
  local body="$1" key="$2"
  echo "$body" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/"
}

# Same, for boolean fields.
json_bool() {
  local body="$1" key="$2"
  echo "$body" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\(true\|false\)" | head -1 | sed -E "s/.*\"$key\"[[:space:]]*:[[:space:]]*(true|false).*/\1/"
}

# ── cleanup (runs on success, failure, or SIGINT) ─────────────────────────────
cleanup() {
  local code=$?
  echo ""
  echo "── Cleanup ──"
  # Delete any sessions seeded directly, by slug prefix (cascades children).
  for slug in "$FULL_SLUG" "$OPEN_SLUG"; do
    srest DELETE "/sessions?slug=eq.$slug" >/dev/null || true
    echo "  removed session slug=$slug"
  done
  # Delete sessions created via admin-action (tracked by id).
  for sid in "${CREATED_SESSION_IDS[@]:-}"; do
    [ -z "$sid" ] && continue
    srest DELETE "/sessions?id=eq.$sid" >/dev/null || true
    echo "  removed session id=$sid"
  done
  # Defensive: drop the facilitator row in case its session_id was already gone.
  srest DELETE "/session_participants?email=eq.$FAC_EMAIL" >/dev/null || true
  exit $code
}
trap cleanup EXIT INT TERM

echo ""
echo "=== Seeded Edge-Function Smoke Tests ==="
echo "    Target:  $SUPABASE_URL"
echo "    Run ID:  $RUN_ID"
echo ""

# ── 1. Seed: 'full' session at cap (max_attendees=2, 2 approved investors) ────
echo "── Seeding ──"
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
END_ISO=$(date -u -d "+1 day" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+1d +%Y-%m-%dT%H:%M:%SZ)

res=$(srest POST "/sessions" -d "$(cat <<JSON
{
  "name": "[SMOKE] $RUN_ID full",
  "slug": "$FULL_SLUG",
  "start_time": "$NOW_ISO",
  "end_time": "$END_ISO",
  "timezone": "UTC",
  "status": "scheduled",
  "max_attendees": 2
}
JSON
)")
s=$(split_status "$res"); b=$(split_body "$res")
FULL_SID=$(json_str "$b" "id")
ok="0"; [ "$s" = "201" ] && [ -n "$FULL_SID" ] && ok="1"
check "seed: full-cap session created" "$ok" "status=$s body=$b"
[ "$ok" = "0" ] && exit 1

# Fill the cap with 2 approved investors.
for i in 1 2; do
  res=$(srest POST "/session_participants" -d "$(cat <<JSON
{
  "session_id": "$FULL_SID",
  "email": "$RUN_ID-inv$i@smoke.test",
  "role": "investor",
  "approved": true,
  "investor_class": "accredited"
}
JSON
)")
  s=$(split_status "$res")
  ok="0"; [ "$s" = "201" ] && ok="1"
  check "seed: approved investor #$i in full-cap session" "$ok" "status=$s body=$(split_body "$res")"
done

# 'open' session with cap=10, no approved investors yet.
res=$(srest POST "/sessions" -d "$(cat <<JSON
{
  "name": "[SMOKE] $RUN_ID open",
  "slug": "$OPEN_SLUG",
  "start_time": "$NOW_ISO",
  "end_time": "$END_ISO",
  "timezone": "UTC",
  "status": "scheduled",
  "max_attendees": 10
}
JSON
)")
s=$(split_status "$res"); b=$(split_body "$res")
OPEN_SID=$(json_str "$b" "id")
ok="0"; [ "$s" = "201" ] && [ -n "$OPEN_SID" ] && ok="1"
check "seed: open-cap session created" "$ok" "status=$s"
[ "$ok" = "0" ] && exit 1

# Seed a facilitator we can log in as. Plaintext password is fine — the
# participant-login function falls back to plaintext compare when the stored
# value doesn't start with '$2' (bcrypt).
res=$(srest POST "/session_participants" -d "$(cat <<JSON
{
  "session_id": "$OPEN_SID",
  "email": "$FAC_EMAIL",
  "role": "facilitator",
  "display_name": "Smoke Facilitator",
  "password_hash": "$FAC_PASSWORD"
}
JSON
)")
s=$(split_status "$res")
ok="0"; [ "$s" = "201" ] && ok="1"
check "seed: facilitator with password" "$ok" "status=$s body=$(split_body "$res")"

# ── 2. event-signup: CAP logic ────────────────────────────────────────────────
echo ""
echo "── event-signup: cap logic ──"

res=$(efn POST "/event-signup" \
  -d "{\"slug\":\"$FULL_SLUG\",\"email\":\"$RUN_ID-rejected@smoke.test\",\"investor_class\":\"accredited\"}")
s=$(split_status "$res"); b=$(split_body "$res")
ok="0"; [ "$s" = "409" ] && echo "$b" | grep -qi "full" && ok="1"
check "full-cap session rejects new signup with 409 'full'" "$ok" "status=$s body=$b"

# ── 3. event-signup: IDEMPOTENCY ──────────────────────────────────────────────
echo ""
echo "── event-signup: idempotency ──"
IDEM_EMAIL="$RUN_ID-idem@smoke.test"

res=$(efn POST "/event-signup" \
  -d "{\"slug\":\"$OPEN_SLUG\",\"email\":\"$IDEM_EMAIL\",\"display_name\":\"Idem\",\"investor_class\":\"community\"}")
s=$(split_status "$res"); b=$(split_body "$res")
already=$(json_bool "$b" "already_registered")
ok="0"; [ "$s" = "200" ] && [ "$already" = "false" ] && ok="1"
check "first signup → 200, already_registered=false" "$ok" "status=$s already=$already body=$b"

res=$(efn POST "/event-signup" \
  -d "{\"slug\":\"$OPEN_SLUG\",\"email\":\"$IDEM_EMAIL\",\"display_name\":\"Idem\",\"investor_class\":\"community\"}")
s=$(split_status "$res"); b=$(split_body "$res")
already=$(json_bool "$b" "already_registered")
ok="0"; [ "$s" = "200" ] && [ "$already" = "true" ] && ok="1"
check "second signup (same email) → 200, already_registered=true" "$ok" "status=$s already=$already body=$b"

# A third signup with the same email AGAIN must still be idempotent. This
# catches regressions where one of the dedupe paths (pre-check vs. 23505
# fallback) silently breaks.
res=$(efn POST "/event-signup" \
  -d "{\"slug\":\"$OPEN_SLUG\",\"email\":\"$IDEM_EMAIL\",\"investor_class\":\"community\"}")
s=$(split_status "$res"); b=$(split_body "$res")
already=$(json_bool "$b" "already_registered")
ok="0"; [ "$s" = "200" ] && [ "$already" = "true" ] && ok="1"
check "third signup (same email) → still idempotent" "$ok" "status=$s already=$already body=$b"

# ── 4. participant-login + admin-action create_session ────────────────────────
echo ""
echo "── participant-login → admin-action create_session ──"

res=$(efn POST "/participant-login" \
  -d "{\"session_id\":\"$OPEN_SID\",\"email\":\"$FAC_EMAIL\",\"password\":\"$FAC_PASSWORD\"}")
s=$(split_status "$res"); b=$(split_body "$res")
ADMIN_TOKEN=$(json_str "$b" "admin_token")
ok="0"; [ "$s" = "200" ] && [ -n "$ADMIN_TOKEN" ] && ok="1"
check "facilitator login returns admin_token" "$ok" "status=$s body=$b"

if [ -n "$ADMIN_TOKEN" ]; then
  CREATE_NAME="[SMOKE] created-by-$RUN_ID"
  res=$(efn POST "/admin-action" -d "$(cat <<JSON
{
  "admin_token": "$ADMIN_TOKEN",
  "action": "create_session",
  "payload": {
    "name": "$CREATE_NAME",
    "start_time": "$NOW_ISO",
    "end_time": "$END_ISO",
    "timezone": "UTC",
    "status": "draft"
  }
}
JSON
)")
  s=$(split_status "$res"); b=$(split_body "$res")
  NEW_SID=$(json_str "$b" "id")
  ok="0"; [ "$s" = "200" ] && [ -n "$NEW_SID" ] && ok="1"
  check "create_session writes a new session" "$ok" "status=$s body=$b"
  [ -n "$NEW_SID" ] && CREATED_SESSION_IDS+=("$NEW_SID")

  # And confirm the row is actually queryable post-write.
  res=$(srest GET "/sessions?id=eq.$NEW_SID&select=id,name")
  s=$(split_status "$res"); b=$(split_body "$res")
  ok="0"; [ "$s" = "200" ] && echo "$b" | grep -q "$CREATE_NAME" && ok="1"
  check "created session is readable via REST" "$ok" "status=$s body=$b"
fi

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
