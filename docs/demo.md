# Demo Call Script

The `scripts/demo_call.py` script launches a live demo session for manual
verification. It opens browser tabs, auto-logs you in, and injects
synthetic video participants so the session feels realistic without
needing real people on the call.

This is the best way to verify that the full stack (Colima, Supabase,
LiveKit, Edge Functions, Vite) is wired up correctly, and to manually
test features from any role's perspective.

---

## Prerequisites

All of the following must be running before you launch the demo:

| Service | How to start | Port |
|---------|-------------|------|
| Colima (Docker runtime) | `colima start --memory 4 --cpu 2` | — |
| Supabase | `supabase start` | 54321 |
| LiveKit | `livekit-server --dev` | 7880 |
| Vite dev server | `npx vite --mode test --port 8080` | 8080 |

Or use `./scripts/test-infra.sh` to start Supabase + LiveKit + seed data
automatically (still need Colima and Vite separately).

**Required CLI tools:**

- `lk` (LiveKit CLI): `brew install livekit-cli`
- `psql`: `brew install libpq && brew link --force libpq`

**Optional:**

- `ffmpeg`: `brew install ffmpeg` — generates visually distinct fixture
  videos per participant (SMPTE bars, test pattern, Mandelbrot). Without
  ffmpeg, all synthetic participants use a generic LiveKit demo stream.

---

## Usage

```
mac% ./scripts/demo_call.py                        # facilitator (default)
mac% ./scripts/demo_call.py --role investor         # investor perspective
mac% ./scripts/demo_call.py --role startup          # startup perspective
mac% ./scripts/demo_call.py --role all              # all 3 roles in separate tabs
```

---

## Role modes

Each `--role` opens specific browser tabs and injects different synthetic
participants. Human-controlled identities are excluded from synthetic
injection so the browser tab is the real participant.

### `--role facilitator` (default)

| Participant | Type | Video source |
|-------------|------|-------------|
| facilitator@test.com | **Browser tab** (you) | Dev's webcam |
| Co-Facilitator B | Synthetic | SMPTE color bars fixture |
| Co-Facilitator C | Synthetic | Blue screen fixture |
| AlphaTech (startup-a) | Synthetic | Test pattern fixture |
| BetaCorp (startup-b) | Synthetic | Mandelbrot fixture |

**What to do:** Click "Start Call", allow camera+mic. Use Next/Previous
to navigate stages. Both startups appear as synthetic fixture video in
the center pane during their respective stages.

### `--role investor`

| Participant | Type | Video source |
|-------------|------|-------------|
| facilitator@test.com | **Browser tab** (for Start Call) | Dev's webcam |
| investor-1@test.com | **Browser tab** (you) | No video (viewer) |
| Co-Facilitator B | Synthetic | SMPTE color bars fixture |
| Co-Facilitator C | Synthetic | Blue screen fixture |
| AlphaTech (startup-a) | Synthetic | Test pattern fixture |
| BetaCorp (startup-b) | Synthetic | Mandelbrot fixture |

**What to do:** Click "Start Call" in the facilitator tab. The investor
tab auto-joins. Use the Invest button during startup presentations.

### `--role startup`

| Participant | Type | Video source |
|-------------|------|-------------|
| facilitator@test.com | **Browser tab** (for Start Call) | Dev's webcam |
| startup-a@test.com | **Browser tab** (you) | Dev's webcam |
| Co-Facilitator B | Synthetic | SMPTE color bars fixture |
| Co-Facilitator C | Synthetic | Blue screen fixture |
| BetaCorp (startup-b) | Synthetic | Mandelbrot fixture |

**What to do:** Click "Start Call" in the facilitator tab. Switch to the
startup tab and click "Join Video Chat" when the session is live. Allow
camera/mic. Your webcam feed appears in the center pane when the
facilitator reaches AlphaTech's presentation stage.

### `--role all`

| Participant | Type | Video source |
|-------------|------|-------------|
| facilitator@test.com | **Browser tab** | Dev's webcam |
| investor-1@test.com | **Browser tab** | No video (viewer) |
| startup-a@test.com | **Browser tab** | Dev's webcam |
| Co-Facilitator B | Synthetic | SMPTE color bars fixture |
| Co-Facilitator C | Synthetic | Blue screen fixture |
| BetaCorp (startup-b) | Synthetic | Mandelbrot fixture |

**What to do:** Click "Start Call" in the facilitator tab. The investor
tab auto-joins. Switch to the startup tab and click "Join Video Chat".
Navigate stages in the facilitator tab to see each startup's video in
the center pane.

**Important:** Startup-A (AlphaTech) is deliberately human-controlled in
this mode. Their video will NOT appear until you click "Join Video Chat"
in the startup tab. This lets you verify the full startup join flow.
Startup-B (BetaCorp) is synthetic and appears automatically.

---

## Video stream behavior

### Synthetic (fixture) streams

Synthetic participants are injected by the script using the `lk` CLI.
If ffmpeg is installed, each participant gets a visually distinct video:

| Participant | Fixture description |
|-------------|-------------------|
| Co-Facilitator B | SMPTE color bars |
| Co-Facilitator C | Blue screen with name overlay |
| AlphaTech (startup-a) | Numbered test pattern |
| BetaCorp (startup-b) | Mandelbrot fractal animation |

Without ffmpeg, all synthetic participants use a generic LiveKit demo
stream (identical for all).

Fixture videos are generated once and cached in
`test-results/demo-videos/`. Delete this directory to regenerate them.

### Real (webcam) streams

Browser tabs that publish video (facilitator, startup) use the dev's
actual webcam. This means:

- In `--role all`, the facilitator and startup-a both show the same
  person's face (yours). This is expected — in production, these would
  be different people on different machines.
- The facilitator's left-pane thumbnail for startup-a will show your
  webcam feed, not a test pattern. This matches production behavior
  (startups publish real video).

---

## Demo vs production differences

| Behavior | Demo | Production |
|----------|------|-----------|
| Login | Auto-login via URL params (`?autoLogin=true`) | Manual email + role + password |
| Video streams | Mix of fixture (synthetic) and webcam (browser) | All real webcams |
| Session creation | Script resets a fixed test session | Facilitator creates via admin |
| Session status | Script sets status to `live` via direct DB update | App updates via Supabase client |
| Multiple roles | All tabs share the same browser/webcam | Different users on different machines |
| Startup-A join | Dev manually clicks "Join Video Chat" | Real startup clicks "Join Video Chat" |
| Startup-B join | Synthetic, auto-injected by script | Real startup clicks "Join Video Chat" |

---

## What the script does (step by step)

1. Checks prerequisites (lk, psql, Supabase, LiveKit, Vite)
2. Reads LiveKit credentials from `supabase/.env.local`
3. Generates fixture video files if ffmpeg is available (cached)
4. Resets the test session to a clean state via `psql`
5. Opens browser tabs with auto-login URLs
6. Waits for the facilitator to click "Start Call" (polls for LiveKit room)
7. Sets session status to `live` via database (for non-facilitator roles)
8. Injects synthetic participants into the LiveKit room
9. Verifies all synthetic participants have published tracks
10. Waits for ENTER to clean up

---

## Logs

Logs for each synthetic participant are saved in
`test-results/demo-logs/lk-{name}.log`. These are useful for debugging
injection failures.

---

## Troubleshooting

### Synthetic participant not appearing

Check the log file in `test-results/demo-logs/`. Common causes:
- LiveKit not running (`curl -sf http://localhost:7880`)
- Wrong credentials in `supabase/.env.local`
- `lk` CLI not installed (`brew install livekit-cli`)

### "Timed out waiting for LiveKit room"

You didn't click "Start Call" in time (60s timeout), or the LiveKit
token Edge Function isn't serving:
```
mac% supabase functions serve
```

### Webcam shows in both facilitator and startup panes

Expected in `--role all` — both tabs share your webcam. In production,
these would be different people.

### No fixture video (all generic streams)

Install ffmpeg and delete the cache:
```
mac% brew install ffmpeg
mac% rm -rf test-results/demo-videos
mac% ./scripts/demo_call.py
```
