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
FIXTURES_DIR="$PROJECT_DIR/test-results/demo-videos"

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
# identity:display_name:color (color used for labeled video generation)
SYNTHETIC_PARTICIPANTS=(
  "facilitator-b@test.com:Co-Facilitator:0x2563EB"
  "startup-a@test.com:AlphaTech:0xDC2626"
  "startup-b@test.com:BetaCorp:0x059669"
)

# ---------- Generate labeled video files (if ffmpeg available) ----------
HAS_FFMPEG=false
if command -v ffmpeg >/dev/null 2>&1; then
  HAS_FFMPEG=true
fi

generate_video() {
  local name="$1" color="$2" outfile="$3"
  if [ -f "$outfile" ]; then return; fi
  mkdir -p "$(dirname "$outfile")"
  # 10-second looping video with participant name, distinct background color
  ffmpeg -y -f lavfi \
    -i "color=c=${color}:size=640x480:rate=30,drawtext=text='${name}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:borderw=2:bordercolor=black" \
    -t 10 -c:v libvpx -b:v 1M "$outfile" \
    -loglevel error
}

if $HAS_FFMPEG; then
  info "Generating labeled video fixtures..."
  for entry in "${SYNTHETIC_PARTICIPANTS[@]}"; do
    IFS=: read -r ident name color <<< "$entry"
    safe_name="${ident%%@*}"
    generate_video "$name" "$color" "$FIXTURES_DIR/${safe_name}.ivf"
  done
  info "Video fixtures ready in $FIXTURES_DIR"
else
  info "ffmpeg not found -- will use generic --publish-demo streams."
  info "Install ffmpeg for labeled per-participant videos: brew install ffmpeg"
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
  IFS=: read -r ident name color <<< "$entry"
  safe_name="${ident%%@*}"
  video_file="$FIXTURES_DIR/${safe_name}.ivf"

  info "Injecting $ident ($name)..."

  if $HAS_FFMPEG && [ -f "$video_file" ]; then
    lk room join \
      --url "$LK_URL" \
      --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" \
      --identity "$ident" \
      --publish "$video_file" --fps 30 \
      "$ROOM_NAME" > /dev/null 2>&1 &
  else
    lk room join \
      --url "$LK_URL" \
      --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" \
      --identity "$ident" \
      --publish-demo \
      "$ROOM_NAME" > /dev/null 2>&1 &
  fi
  PIDS+=($!)
  sleep 1
done

echo ""
info "Demo call is live!"
echo ""
echo "    Your camera:  facilitator@test.com (left pane)"
echo "    Synthetic:    Co-Facilitator (left pane, blue label)"
echo "    Synthetic:    AlphaTech startup (center pane, red label)"
echo "    Synthetic:    BetaCorp startup (center pane, green label)"
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
