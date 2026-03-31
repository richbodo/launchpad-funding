# Video Debugging Guide

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
| "LiveKit not configured on server" | Edge Functions missing secrets | Run `./scripts/test-infra.sh` |
| Token fetched but no video | WebRTC negotiation incomplete | Increase timeout or test manually |
| "Start Call" does nothing | Token fetch failed silently | Check browser console for errors |
| Video works manually, not in tests | Fake media device timing | Add `waitForTimeout` or use `slowMo` |
| No rooms listed in `lk room list` | No one has joined yet | Start a call first, then check |
