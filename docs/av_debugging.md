# Audio/Video Reference & Debugging Guide

## How participants join and leave calls

All video and audio runs through LiveKit (a WebRTC SFU). Each session
maps to one LiveKit room (`session-{session_id}`). When a participant
joins, the browser requests camera and microphone permissions.

| Role | How they join | Publishes | Browser prompt |
|------|--------------|-----------|----------------|
| **Facilitator** | Clicks **Start Call** (first) or **Join Call** (subsequent) | Video + Audio | Camera + Mic |
| **Startup** | Clicks **Join Video Chat** in header (when session is live) | Video + Audio | Camera + Mic |
| **Investor** | Auto-joins when session goes live | Nothing (viewer only) | None |

**Leaving:** The facilitator clicks **End Call** to end the session.
All participants are disconnected automatically and the session moves
to `completed` status. Individual participants can also leave by
navigating away or closing the tab.

---

## Audio controls

### Who can hear whom

All facilitators and the on-stage startup publish audio. Their audio
streams are mixed by each participant's browser. Investors never
publish audio — they are listen-only.

### Personal volume mute (all roles)

Every participant has a **speaker icon** in the header bar (top right).
Clicking it mutes all incoming audio from the app to the participant —
like muting a YouTube video. This is entirely local and does not
affect what anyone else hears.

- Click speaker icon: all app audio silenced for you
- Click again: audio restored
- No effect on other participants
- Use case: taking a phone call, talking to someone in the room

### Mic toggle (facilitators and startups only)

Facilitators and startups see a **microphone icon** in the center pane
area (below the stage video, inside the LiveKit session). Clicking it
toggles their own microphone on or off.

- Click mic icon: your mic is muted (no one hears you)
- Click again: your mic is live again
- Investors do not have this control (they never publish audio)

### Facilitator admin mute

Facilitators see a **small mic icon** next to each participant in the
left sidebar (beside the "Take Stage" button). Clicking it server-side
mutes that participant's microphone for everyone via the LiveKit admin
API.

**Remote unmute is not supported.** This is a LiveKit security
restriction — you can force-mute someone, but you cannot force-unmute
them. Once a facilitator admin-mutes a participant:

- The participant's admin mute button turns red and becomes disabled
- The tooltip reads: "Muted (participant must unmute themselves)"
- The muted participant must use their own **mic toggle** to unmute
- The facilitator cannot unmute them remotely

Use cases: a participant's mic is creating feedback or background
noise, someone left their mic hot while away, or a facilitator needs
to silence a disruptive audio source.

### Stage etiquette nudge

When the session advances to a startup's presentation or Q&A stage,
any facilitator with their mic still enabled receives a toast:
*"A startup is presenting — consider muting your mic."* This is a
reminder only — the app does not auto-mute facilitators.

### Screen sharing (Present mode)

Any participant who is on stage (via Take Stage or during their
presentation) sees a **Present** button below the stage video.
Clicking it triggers the browser's screen share picker. The shared
screen replaces the camera feed in the center pane for all
participants. Click **Stop Presenting** to revert to camera. Screen
sharing auto-stops when the stage advances.

---

## Quick demo: one-command live call

The fastest way to verify the video stack works:

```
mac% ./scripts/demo_call.py
```

This auto-logs you in as the facilitator. Click "Start Call", allow
camera+mic, then press ENTER in the terminal. The script injects four
synthetic video participants via the `lk` CLI:

- **Co-Facilitator B** — SMPTE color bars (left pane)
- **Co-Facilitator C** — blue screen with name overlay (left pane)
- **AlphaTech** — numbered test pattern (center pane)
- **BetaCorp** — Mandelbrot fractal (center pane)

Use Next/Previous to switch between startups — each has a visually
distinct stream so you can confirm the center pane is switching
correctly.

The script also supports `--role investor`, `--role startup`, and
`--role all` to test from other perspectives. See [docs/demo.md](demo.md)
for full details on each role mode, which participants are synthetic vs
browser-controlled, and expected video behavior.

Requires: Supabase, LiveKit, and Vite dev server running (via
`test-infra.sh`). Optional: ffmpeg for distinct per-participant video
streams (falls back to generic LiveKit demo streams without it).

Logs from each synthetic participant are saved in
`test-results/demo-logs/`.

---

## Running E2E tests with a visible browser

Playwright can open a real browser window so you can watch the tests:

```
mac% npx playwright test tests/e2e/videoCall.spec.ts --headed
```

Other useful modes:

```
mac% npx playwright test --headed              # all tests, visible browser
mac% npx playwright test --ui                   # interactive dashboard with replay
mac% npx playwright test --debug                # step-by-step with Playwright Inspector
mac% npx playwright show-trace <trace.zip>      # replay a recorded trace file
```

---

## Why video feeds may not appear in E2E tests

Even with `--headed` and fake media devices, you may not see `<video>` elements
render. There are several reasons this can happen, listed from most to least
likely.

### 1. Edge Functions not serving LiveKit secrets

The `livekit-token` Edge Function needs `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
and `LIVEKIT_WS_URL` as environment variables. `supabase start` runs Edge
Functions but **does not** load `supabase/.env.local`. You need to run
`supabase functions serve` separately, which `test-infra.sh` does automatically.

**Verify the token endpoint works:**

```
mac% curl -s http://127.0.0.1:54321/functions/v1/livekit-token \
  -H "Content-Type: application/json" \
  -H "apikey: $(grep VITE_SUPABASE_PUBLISHABLE_KEY .env.test | cut -d'"' -f2)" \
  -H "Authorization: Bearer $(grep VITE_SUPABASE_PUBLISHABLE_KEY .env.test | cut -d'"' -f2)" \
  -d '{"session_id":"00000000-0000-0000-0000-000000000001","identity":"facilitator@test.com","name":"Test","role":"facilitator"}'
```

You should see a JSON response with `token`, `ws_url`, and `room` fields.
If you see `{"error":"LiveKit not configured on server"}`, Edge Functions
aren't loading the secrets — run `./scripts/test-infra.sh` to fix this.

### 2. WebRTC track publication timing

The app sets `callState = 'connected'` immediately after fetching the token,
before LiveKitRoom has actually joined the room and published tracks. The
`<video>` element only appears when `useTracks()` returns a camera track,
which requires:

1. LiveKitRoom connects to the LiveKit server via WebSocket
2. ICE negotiation completes (STUN/TURN)
3. Local camera track is published
4. The track appears in `useTracks()` results
5. React re-renders the VideoPane with the track

This typically takes 2-5 seconds with a local LiveKit server. In E2E tests,
the test may assert before this pipeline completes.

### 3. Chromium fake media limitations

Playwright launches Chromium with these flags for fake camera/mic:

```
--use-fake-ui-for-media-stream
--use-fake-device-for-media-stream
```

This provides a synthetic animated test pattern instead of a real camera.
In some environments (especially CI/headless), the fake device may not
produce frames quickly enough for LiveKit to detect an active track.

---

## How to watch video feeds during tests

### Option A: Slow down tests with a pause

Add a manual pause to the test so you can watch the video feed render.
Edit the test temporarily:

```ts
// After clicking Start Call, wait for connection + track publication
await page.click('text=Start Call');
await expect(page.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

// Pause here to watch the video feed
await page.waitForTimeout(10_000); // 10 seconds to observe
```

Run with:

```
mac% npx playwright test tests/e2e/videoCall.spec.ts --headed
```

### Option B: Use debug mode for step-by-step control

```
mac% npx playwright test tests/e2e/videoCall.spec.ts --debug
```

This opens the Playwright Inspector. Click "Step Over" to advance one
line at a time. After the "Start Call" click, wait and watch the browser
window for video elements to appear.

### Option C: Use slowMo to slow down all actions

Add `slowMo` to `playwright.config.ts` temporarily:

```ts
projects: [
  {
    name: 'chromium-fake-media',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: {
        slowMo: 1000, // 1 second delay between each action
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
        ],
      },
    },
  },
],
```

Then run with `--headed`.

### Option D: Test video manually with the demo script

The most reliable way to verify video works is manual testing via the
demo script, which handles login, session setup, and synthetic
participants for you:

```
mac% ./scripts/demo_call.py --role all
```

See [docs/demo.md](demo.md) for the full walkthrough. If video works
via the demo but not in Playwright, the issue is test timing or
Chromium's fake media device, not the application.

---

## Checking browser console during tests

To see LiveKit errors and connection logs during headed runs, add this
to your test before the Start Call click:

```ts
page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));
```

Look for:
- `LiveKit error:` — logged by Session.tsx's `onError` handler
- `Failed to get LiveKit token` — token fetch failed
- WebRTC ICE errors — network/firewall issues

---

## Verifying LiveKit server is working

### Check server is responding

```
mac% curl -s http://localhost:7880
```

### Check a room exists after starting a call

```
mac% lk room list --url ws://localhost:7880 --api-key devkey --api-secret secret
```

### Inject a test participant with demo video

Use the LiveKit CLI to inject a synthetic video stream without needing
a browser:

```
mac% lk room join \
  --url ws://localhost:7880 \
  --api-key devkey --api-secret secret \
  --identity startup-a@test.com \
  --publish-demo \
  session-00000000-0000-0000-0000-000000000001
```

This publishes an animated demo stream as `startup-a@test.com`. If
the facilitator's browser shows this video in the center pane, the
LiveKit → app → VideoPane pipeline is working correctly.

---

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| "LiveKit not configured on server" | Edge Functions missing secrets | Run `supabase functions serve --env-file supabase/.env.local` |
| Token fetched but no video | WebRTC negotiation incomplete | Increase timeout or test manually |
| "Start Call" does nothing | Token fetch failed silently | Check browser console for errors |
| Video works manually, not in tests | Fake media device timing | Add `waitForTimeout` or use `slowMo` |
| No rooms listed in `lk room list` | No one has joined yet | Start a call first, then check |
| "Failed to mute participant" | Edge Function can't reach LiveKit | Ensure `host.docker.internal` resolves (Docker/Colima issue) |
| Admin mute works but unmute fails | LiveKit security restriction | Expected — participant must self-unmute via their mic toggle |
| Run `./scripts/test-infra-test.sh` to verify all services | — | Checks Supabase, LiveKit, Edge Functions, Vite, and demo mode |
