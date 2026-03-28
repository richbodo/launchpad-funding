#!/usr/bin/env bash
#
# Shuts down the local test infrastructure started by test-infra.sh.
#
# Usage:
#   mac% ./scripts/test-infra-stop.sh          # stop Supabase + LiveKit (preserve data)
#   mac% ./scripts/test-infra-stop.sh --clean  # also wipe Supabase data
#
set -euo pipefail

CLEAN_FLAG="${1:-}"

info()  { echo "==> $*"; }

# ---------- Stop Edge Functions serve ----------
FUNC_PIDS=$(pgrep -f "supabase functions serve" 2>/dev/null || true)
if [ -n "$FUNC_PIDS" ]; then
  info "Stopping supabase functions serve..."
  echo "$FUNC_PIDS" | xargs kill 2>/dev/null || true
  echo "    Edge Functions stopped."
else
  info "supabase functions serve not running."
fi

# ---------- Stop LiveKit ----------
if lsof -ti :7880 > /dev/null 2>&1; then
  info "Stopping LiveKit server..."
  lsof -ti :7880 | xargs kill 2>/dev/null || true
  sleep 1
  # Force kill if still running
  lsof -ti :7880 | xargs kill -9 2>/dev/null || true
  echo "    LiveKit stopped."
else
  info "LiveKit not running."
fi

# ---------- Stop Supabase ----------
if curl -sf http://127.0.0.1:54321 > /dev/null 2>&1; then
  if [ "$CLEAN_FLAG" = "--clean" ]; then
    info "Stopping Supabase and wiping all data..."
    supabase stop --no-backup
  else
    info "Stopping Supabase (data preserved for next start)..."
    supabase stop
  fi
  echo "    Supabase stopped."
else
  info "Supabase not running."
fi

# ---------- Stop Vite dev server if running ----------
if lsof -ti :8080 > /dev/null 2>&1; then
  info "Stopping Vite dev server on port 8080..."
  lsof -ti :8080 | xargs kill 2>/dev/null || true
  echo "    Vite stopped."
fi

echo ""
info "All test services stopped."
if [ "$CLEAN_FLAG" != "--clean" ]; then
  echo "    Data preserved. Use --clean to wipe Supabase data."
fi
