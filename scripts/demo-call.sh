#!/usr/bin/env bash
#
# Launches a live demo call for manual testing.
#
# Opens your browser and auto-logs you in as the facilitator (demo mode
# bypasses password). Injects a second facilitator and two startups as
# synthetic video participants, each with a visually distinct stream.
#
# Usage:
#   mac% ./scripts/demo-call.sh
#
# Prerequisites:
#   - Supabase and LiveKit running (via ./scripts/test-infra.sh)
#   - lk CLI installed (brew install livekit-cli)
#   - Vite dev server running (npx vite --mode test --port 8080)
#   - ffmpeg (optional, for labeled video streams; falls back to --publish-demo)
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

# ---------- Participants to inject ----------
# identity|display_name|filter|port
# Each gets a distinct ffmpeg test source streamed via TCP to lk
SYNTHETIC_PARTICIPANTS=(
  "facilitator-b@test.com|Co-Facilitator|smptebars=size=640x480:rate=30|5551"
  "startup-a@test.com|AlphaTech|testsrc=size=640x480:rate=30|5552"
  "startup-b@test.com|BetaCorp|mandelbrot=size=640x480:rate=30|5553"
)

# ---------- Check for ffmpeg ----------
HAS_FFMPEG=false
if command -v ffmpeg >/dev/null 2>&1; then
  HAS_FFMPEG=true
else
  info "ffmpeg not found -- will use generic --publish-demo streams (all look the same)."
  info "Install ffmpeg for distinct per-participant videos: brew install ffmpeg"
fi

# ---------- Reset test session ----------
info "Resetting test session to 'scheduled' status..."
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -qc \
  "UPDATE sessions SET status = 'scheduled' WHERE id = '$SESSION_ID';" 2>/dev/null

# Clear any stale login flags
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -qc \
  "UPDATE session_participants SET is_logged_in = false WHERE session_id = '$SESSION_ID';" 2>/dev/null

# ---------- Open browser with auto-login ----------
info "Opening browser (auto-login as facilitator)..."
open "http://localhost:8080/login?autoLogin=true&email=facilitator@test.com&role=facilitator"

echo ""
echo "============================================================"
echo "  Browser opened -- you will be auto-logged in as the"
echo "  facilitator. Click 'Start Call' and allow camera+mic,"
echo "  then press ENTER here to inject the other participants."
echo "============================================================"
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
PIDS=()

for entry in "${SYNTHETIC_PARTICIPANTS[@]}"; do
  IFS='|' read -r ident name filter port <<< "$entry"

  info "Injecting $ident ($name)..."

  if $HAS_FFMPEG; then
    # Stream an endless test pattern from ffmpeg → TCP → lk
    ffmpeg -re -f lavfi -i "$filter" \
      -c:v vp8 -b:v 1M -f ivf \
      "tcp://127.0.0.1:${port}?listen=1" \
      -loglevel error > /dev/null 2>&1 &
    PIDS+=($!)
    sleep 1  # give ffmpeg time to start listening

    lk room join \
      --url "$LK_URL" \
      --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" \
      --identity "$ident" \
      --publish "vp8://127.0.0.1:${port}" \
      "$ROOM_NAME" > /dev/null 2>&1 &
    PIDS+=($!)
  else
    lk room join \
      --url "$LK_URL" \
      --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" \
      --identity "$ident" \
      --publish-demo \
      "$ROOM_NAME" > /dev/null 2>&1 &
    PIDS+=($!)
  fi
  sleep 1
done

echo ""
info "Demo call is live!"
echo ""
echo "    Your camera:  facilitator@test.com (left pane)"
echo "    Synthetic:    Co-Facilitator (left pane, SMPTE color bars)"
echo "    Synthetic:    AlphaTech startup (center pane, numbered test pattern)"
echo "    Synthetic:    BetaCorp startup (center pane, Mandelbrot fractal)"
echo ""
echo "    Use Next/Previous to switch between startup presentations."
echo "    Each startup has a visually distinct video stream."
echo ""
echo "    Press ENTER to end the demo and clean up."
echo ""
read -r -p "Press ENTER to stop synthetic participants..."

# ---------- Cleanup ----------
info "Stopping synthetic participants..."
for pid in "${PIDS[@]}"; do
  kill "$pid" 2>/dev/null || true
done
for pid in "${PIDS[@]}"; do
  wait "$pid" 2>/dev/null || true
done

info "Demo ended. The browser session is still active -- click 'End Call' to finish."
