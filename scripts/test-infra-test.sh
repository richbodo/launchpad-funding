#!/usr/bin/env bash
#
# Verifies that all test infrastructure services are running and responding correctly.
#
# Usage:
#   mac% ./scripts/test-infra-test.sh
#
set -euo pipefail

SUPABASE_URL="http://127.0.0.1:54321"
LIVEKIT_URL="http://localhost:7880"
VITE_URL="http://localhost:8080"
PUB_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
SESSION_ID="00000000-0000-0000-0000-000000000001"

PASS=0
FAIL=0

check() {
  local label="$1"
  local ok="$2"
  if [ "$ok" = "1" ]; then
    echo "  ✅  $label"
    PASS=$((PASS + 1))
  else
    echo "  ❌  $label"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== Infrastructure Health Check ==="
echo ""

# 1. Supabase API
echo "── Supabase ──"
SUPA_OK=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/rest/v1/" -H "apikey: $PUB_KEY" -H "Authorization: Bearer $PUB_KEY" 2>/dev/null || echo "000")
SUPA_CHECK="0"
if [ "$SUPA_OK" = "200" ]; then SUPA_CHECK="1"; fi
check "Supabase REST API responding at $SUPABASE_URL" "$SUPA_CHECK"

# 2. Supabase REST API — sessions table
SESSIONS=$(curl -sf "$SUPABASE_URL/rest/v1/sessions?id=eq.$SESSION_ID&select=id,status" -H "apikey: $PUB_KEY" -H "Authorization: Bearer $PUB_KEY" 2>/dev/null || echo "")
SESSIONS_OK="0"
if echo "$SESSIONS" | grep -q "$SESSION_ID"; then SESSIONS_OK="1"; fi
check "Test session exists in database" "$SESSIONS_OK"
if [ -n "$SESSIONS" ] && [ "$SESSIONS_OK" = "1" ]; then
  echo "         $SESSIONS"
fi

# 3. Supabase REST API — session_participants (SELECT * works)
PARTS=$(curl -sf "$SUPABASE_URL/rest/v1/session_participants?session_id=eq.$SESSION_ID&select=email,role&order=role" -H "apikey: $PUB_KEY" -H "Authorization: Bearer $PUB_KEY" 2>/dev/null || echo "")
PARTS_OK="0"
if echo "$PARTS" | grep -q "facilitator@test.com"; then PARTS_OK="1"; fi
check "Participants queryable (SELECT grant working)" "$PARTS_OK"

PARTS_STAR=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/rest/v1/session_participants?session_id=eq.$SESSION_ID&limit=1" -H "apikey: $PUB_KEY" -H "Authorization: Bearer $PUB_KEY" 2>/dev/null || echo "000")
STAR_OK="0"
if [ "$PARTS_STAR" = "200" ]; then STAR_OK="1"; fi
check "Participants select(*) returns 200 (not 403)" "$STAR_OK"

# 4. LiveKit server
echo ""
echo "── LiveKit ──"
LK_OK=$(curl -sf -o /dev/null -w "1" "$LIVEKIT_URL" 2>/dev/null || echo "0")
check "LiveKit server responding at $LIVEKIT_URL" "$LK_OK"

# 5. LiveKit token Edge Function
LK_TOKEN=$(curl -sf "$SUPABASE_URL/functions/v1/livekit-token" -H "Content-Type: application/json" -H "apikey: $PUB_KEY" -H "Authorization: Bearer $PUB_KEY" -d "{\"session_id\":\"$SESSION_ID\",\"identity\":\"facilitator@test.com\",\"name\":\"Test\",\"role\":\"facilitator\"}" 2>/dev/null || echo "")
TOKEN_OK="0"
if echo "$LK_TOKEN" | grep -q '"token"'; then TOKEN_OK="1"; fi
check "livekit-token Edge Function returns a token" "$TOKEN_OK"
if [ "$TOKEN_OK" = "0" ] && [ -n "$LK_TOKEN" ]; then
  echo "         Response: $LK_TOKEN"
  echo "         Fix: supabase stop && supabase start (so .env.local is loaded)"
fi

# 6. Mute participant Edge Function (should return 400 for missing params)
MUTE_RESP=$(curl -s "$SUPABASE_URL/functions/v1/mute-participant" -H "Content-Type: application/json" -H "apikey: $PUB_KEY" -H "Authorization: Bearer $PUB_KEY" -d "{}" 2>/dev/null || echo "")
MUTE_OK="0"
if echo "$MUTE_RESP" | grep -q '"error"'; then MUTE_OK="1"; fi
if echo "$MUTE_RESP" | grep -q '"success"'; then MUTE_OK="1"; fi
check "mute-participant Edge Function is deployed" "$MUTE_OK"
if [ "$MUTE_OK" = "0" ] && [ -n "$MUTE_RESP" ]; then
  echo "         Response: $MUTE_RESP"
fi

# 7. Participant login Edge Function
LOGIN_RESP=$(curl -sf "$SUPABASE_URL/functions/v1/participant-login" -H "Content-Type: application/json" -H "apikey: $PUB_KEY" -H "Authorization: Bearer $PUB_KEY" -d "{\"session_id\":\"$SESSION_ID\",\"email\":\"facilitator@test.com\",\"password\":\"test123\"}" 2>/dev/null || echo "")
LOGIN_OK="0"
if echo "$LOGIN_RESP" | grep -q '"success":true'; then LOGIN_OK="1"; fi
check "participant-login Edge Function verifies password" "$LOGIN_OK"
if [ "$LOGIN_OK" = "0" ] && [ -n "$LOGIN_RESP" ]; then
  echo "         Response: $LOGIN_RESP"
  echo "         (Password may be bcrypt-hashed; 'test123' must match)"
fi

# 8. Vite dev server
echo ""
echo "── Vite ──"
VITE_OK=$(curl -sf -o /dev/null -w "1" "$VITE_URL" 2>/dev/null || echo "0")
check "Vite dev server responding at $VITE_URL" "$VITE_OK"
if [ "$VITE_OK" = "0" ]; then
  echo "         Start it: npx vite --mode test --port 8080"
fi

# 9. Demo mode enabled
echo ""
echo "── App Config ──"
DEMO=$(curl -sf "$SUPABASE_URL/rest/v1/app_settings?key=eq.mode&select=value" -H "apikey: $PUB_KEY" -H "Authorization: Bearer $PUB_KEY" 2>/dev/null || echo "")
DEMO_OK="0"
if echo "$DEMO" | grep -q '"demo"'; then DEMO_OK="1"; fi
check "Demo mode is enabled" "$DEMO_OK"

# Summary
echo ""
echo "───────────────────────────────"
echo "  Results: $PASS passed, $FAIL failed"
echo "───────────────────────────────"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
