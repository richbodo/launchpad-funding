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
#   - ffmpeg (optional, for distinct video streams; falls back to --publish-demo)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VIDEO_DIR="$PROJECT_DIR/test-results/demo-videos"
LOG_DIR="$PROJECT_DIR/test-results/demo-logs"

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
# identity|display_name|ffmpeg_filter
SYNTHETIC_PARTICIPANTS=(
  "facilitator-b@test.com|Co-Facilitator|smptebars=size=320x240:rate=15"
  "startup-a@test.com|AlphaTech|testsrc=size=320x240:rate=15"
  "startup-b@test.com|BetaCorp|mandelbrot=size=320x240:rate=15"
)

# ---------- Generate video fixtures (if ffmpeg available) ----------
HAS_FFMPEG=false
if command -v ffmpeg >/dev/null 2>&1; then
  HAS_FFMPEG=true
else
  info "ffmpeg not found -- will use generic --publish-demo streams (all look the same)."
  info "Install ffmpeg for distinct per-participant videos: brew install ffmpeg"
fi

VIDEO_DURATION=300  # 5 minutes — long enough for any demo session

if $HAS_FFMPEG; then
  mkdir -p "$VIDEO_DIR"
  NEEDS_GEN=false
  for entry in "${SYNTHETIC_PARTICIPANTS[@]}"; do
    IFS='|' read -r ident name filter <<< "$entry"
    safe_name="${ident%%@*}"
    [ -f "$VIDEO_DIR/${safe_name}.ivf" ] || NEEDS_GEN=true
  done

  if $NEEDS_GEN; then
    info "One-time video fixture generation (cached for future runs)..."
    for entry in "${SYNTHETIC_PARTICIPANTS[@]}"; do
      IFS='|' read -r ident name filter <<< "$entry"
      safe_name="${ident%%@*}"
      outfile="$VIDEO_DIR/${safe_name}.ivf"
      if [ -f "$outfile" ]; then
        continue
      fi
      info "  Generating $name (~5s)..."
      ffmpeg -y -f lavfi -i "$filter" \
        -t "$VIDEO_DURATION" -c:v libvpx -b:v 500k "$outfile" \
        -loglevel error
    done
    info "Video fixtures cached in test-results/demo-videos/"
  fi
fi

# ---------- Prepare log directory ----------
mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR"/*.log

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

# publish_loop: re-publishes the video file when it ends, keeping the
# participant in the room indefinitely.
publish_loop() {
  local ident="$1" video_file="$2" logfile="$3"
  while true; do
    lk room join \
      --url "$LK_URL" \
      --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" \
      --identity "$ident" \
      --publish "$video_file" --fps 15 \
      --exit-after-publish \
      "$ROOM_NAME" >> "$logfile" 2>&1
    # Brief pause before re-joining (avoids tight loop on error)
    sleep 1
  done
}

for entry in "${SYNTHETIC_PARTICIPANTS[@]}"; do
  IFS='|' read -r ident name filter <<< "$entry"
  safe_name="${ident%%@*}"
  logfile="$LOG_DIR/lk-${safe_name}.log"

  info "Injecting $ident ($name)..."

  if $HAS_FFMPEG && [ -f "$VIDEO_DIR/${safe_name}.ivf" ]; then
    publish_loop "$ident" "$VIDEO_DIR/${safe_name}.ivf" "$logfile" &
    PIDS+=($!)
  else
    lk room join \
      --url "$LK_URL" \
      --api-key "$LK_API_KEY" --api-secret "$LK_API_SECRET" \
      --identity "$ident" \
      --publish-demo \
      "$ROOM_NAME" \
      > "$logfile" 2>&1 &
    PIDS+=($!)
  fi
  sleep 2
done

# ---------- Verify participants joined ----------
sleep 3
info "Checking participant status..."
for entry in "${SYNTHETIC_PARTICIPANTS[@]}"; do
  IFS='|' read -r ident name filter <<< "$entry"
  safe_name="${ident%%@*}"
  logfile="$LOG_DIR/lk-${safe_name}.log"

  if grep -q "published track" "$logfile" 2>/dev/null; then
    echo "    OK:   $name -- track published"
  elif grep -qi "error" "$logfile" 2>/dev/null; then
    echo "    FAIL: $name -- check $logfile"
    grep -i error "$logfile" | tail -2 | sed 's/^/          /'
  else
    echo "    WAIT: $name -- still connecting (check $logfile)"
  fi
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
echo "    Logs: $LOG_DIR/"
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
info "Logs saved in: $LOG_DIR/"
