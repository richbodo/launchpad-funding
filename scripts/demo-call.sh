#!/usr/bin/env bash
#
# Launches a live demo call for manual testing.
#
# Opens your browser so you can log in as the facilitator with your real
# camera. Once you start the call, this script injects synthetic video
# participants (a startup and an investor) via the LiveKit CLI so you
# see a multi-person call.
#
# Usage:
#   mac% ./scripts/demo-call.sh
#
# Prerequisites:
#   - Supabase and LiveKit running (via ./scripts/test-infra.sh)
#   - lk CLI installed (brew install livekit-cli)
#   - Vite dev server running (npx vite --mode test --port 8080)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

info()  { echo "==> $*"; }
die()   { echo "ERROR: $*" >&2; exit 1; }

# ---------- Prerequisite checks ----------
command -v lk >/dev/null 2>&1 || die "lk CLI not found. Install: brew install livekit-cli"
curl -so /dev/null -w '%{http_code}' http://127.0.0.1:54321 2>/dev/null | grep -q '[2-4]' || die "Supabase not running. Run: ./scripts/test-infra.sh"
curl -sf http://localhost:7880 > /dev/null 2>&1 || die "LiveKit not running. Run: livekit-server --dev"
curl -sf http://localhost:8080 > /dev/null 2>&1 || die "Vite dev server not running. Run: npx vite --mode test --port 8080"

# ---------- LiveKit credentials ----------
LK_API_KEY=$(grep 'LIVEKIT_API_KEY=' "$PROJECT_DIR/supabase/.env.local" 2>/dev/null | cut -d= -f2- || echo "devkey")
LK_API_SECRET=$(grep 'LIVEKIT_API_SECRET=' "$PROJECT_DIR/supabase/.env.local" 2>/dev/null | cut -d= -f2- || echo "secret")
LK_URL="ws://localhost:7880"

SESSION_ID="00000000-0000-0000-0000-000000000001"
ROOM_NAME="session-${SESSION_ID}"

# ---------- Reset test session ----------
info "Resetting test session to 'scheduled' status..."
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -qc \
  "UPDATE sessions SET status = 'scheduled' WHERE id = '$SESSION_ID';" 2>/dev/null

# Clear any stale login flags
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -qc \
  "UPDATE session_participants SET is_logged_in = false WHERE session_id = '$SESSION_ID';" 2>/dev/null

# ---------- Open browser ----------
info "Opening browser to login page..."
open "http://localhost:8080/login"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  1. Log in as: facilitator@test.com / test123              ║"
echo "║  2. Click 'Start Call'                                     ║"
echo "║  3. Allow camera + microphone when prompted                ║"
echo "║  4. Come back here and press ENTER                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
read -r -p "Press ENTER after you've started the call..."

# ---------- Verify room exists ----------
info "Checking LiveKit room..."
ROOM_EXISTS=$(lk room list --url "$LK_URL" --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" 2>/dev/null | grep -c "$ROOM_NAME" || echo "0")

if [ "$ROOM_EXISTS" = "0" ]; then
  echo "WARNING: Room '$ROOM_NAME' not found. Make sure you clicked 'Start Call'."
  echo "         Attempting to inject participants anyway..."
fi

# ---------- Inject synthetic participants ----------
info "Injecting startup-a@test.com (AlphaTech) with demo video..."
lk room join \
  --url "$LK_URL" \
  --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" \
  --identity "startup-a@test.com" \
  --publish-demo \
  "$ROOM_NAME" > /dev/null 2>&1 &
STARTUP_PID=$!

sleep 1

info "Injecting startup-b@test.com (BetaCorp) with demo video..."
lk room join \
  --url "$LK_URL" \
  --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" \
  --identity "startup-b@test.com" \
  --publish-demo \
  "$ROOM_NAME" > /dev/null 2>&1 &
BETACORP_PID=$!

echo ""
info "Demo call is live!"
echo ""
echo "    Your camera: facilitator (left pane)"
echo "    Synthetic:   AlphaTech startup (center pane when on their stage)"
echo "    Synthetic:   BetaCorp startup (center pane when on their stage)"
echo ""
echo "    Use Next/Previous to switch between startup presentations."
echo "    The center pane will show each startup's synthetic video."
echo ""
echo "    Press ENTER to end the demo and clean up."
echo ""
read -r -p "Press ENTER to stop synthetic participants..."

# ---------- Cleanup ----------
info "Stopping synthetic participants..."
kill $STARTUP_PID $BETACORP_PID 2>/dev/null || true
wait $STARTUP_PID $BETACORP_PID 2>/dev/null || true

info "Demo ended. The browser session is still active — click 'End Call' to finish."
