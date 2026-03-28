# FundFlow Video & Integration Test Plan

## Why this plan exists

This app is a real-time multi-user platform. You cannot build confidence in it by
testing components in isolation — the value comes from proving that three browser
windows, connected to real Supabase and real LiveKit, produce the right experience
for each role simultaneously. The E2E tests are the centerpiece. Everything else
supports them.

## The hard constraint

FundFlow depends on two external services that cannot be trivially mocked:

1. **Supabase** — Postgres, Realtime subscriptions, Edge Functions (Deno).
   The app uses Realtime for live investment updates, chat, and session status
   changes. The `livekit-token` Edge Function generates signed JWTs for LiveKit
   room access with role-based publish permissions.

2. **LiveKit** — WebRTC SFU. Facilitators and startups publish camera/mic;
   investors subscribe as viewers. Track routing, room membership, and publish
   permissions are enforced server-side by the LiveKit SFU using claims baked
   into the JWT by the Edge Function.

Both services **can be run locally**. That is the foundation of this test plan.

---

## Part 1 — Local test infrastructure

### 1.1 Local Supabase

The project already has `supabase/` with 7 migrations and Edge Functions. The
Supabase CLI runs a full local stack (Postgres, GoTrue, Realtime, Edge Functions)
via Docker.

```bash
# One-time setup
brew install supabase/tap/supabase   # or: npm install -g supabase

# Start local stack (requires Docker running)
supabase start
```

`supabase start` prints local credentials:

```
API URL:   http://localhost:54321
anon key:  eyJ...
service_role key: eyJ...
```

Migrations apply automatically. Edge Functions (including `livekit-token`) are
served at `http://localhost:54321/functions/v1/<name>`.

### 1.2 Local LiveKit

LiveKit provides an open-source server binary.

```bash
# macOS
brew install livekit

# Start in dev mode (generates ephemeral API key + secret, prints them)
livekit-server --dev

# Or via Docker:
docker run --rm \
  -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev
```

The `--dev` flag prints a temporary API key and secret on startup. Note these —
they go into the Supabase Edge Function secrets.

### 1.3 Wiring them together

Create `.env.test` (Vite loads this when run with `--mode test`):

```bash
VITE_SUPABASE_URL="http://localhost:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon key from supabase start>"
VITE_LIVEKIT_WS_URL="ws://localhost:7880"
```

Set Edge Function secrets so the `livekit-token` function can reach local LiveKit:

```bash
# Create supabase/.env.local (read by supabase functions serve)
cat > supabase/.env.local <<EOF
LIVEKIT_API_KEY=<key from livekit-server --dev>
LIVEKIT_API_SECRET=<secret from livekit-server --dev>
LIVEKIT_WS_URL=ws://localhost:7880
EOF
```

### 1.4 Startup script

Create `scripts/test-infra.sh` to orchestrate local services:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Starting local Supabase..."
supabase start

echo "==> Starting local LiveKit..."
livekit-server --dev --bind 0.0.0.0 &
LIVEKIT_PID=$!

# Wait for LiveKit to be ready
for i in {1..10}; do
  curl -sf http://localhost:7880 > /dev/null 2>&1 && break
  sleep 1
done

echo "==> Seeding test data..."
# Reset DB to clean state and seed
supabase db reset

# Insert test fixture data directly via psql
psql "$( supabase status -o env | grep DATABASE_URL | cut -d= -f2- )" \
  -f tests/fixtures/seed.sql

echo "==> Infrastructure ready."
echo "    Supabase: http://localhost:54321"
echo "    LiveKit:  ws://localhost:7880"
echo ""
echo "Run tests with: npx playwright test"
echo "Kill LiveKit with: kill $LIVEKIT_PID"
```

### 1.5 Test data fixture

**Location:** `tests/fixtures/seed.sql`

This SQL runs against local Supabase after `db reset`. It creates a known,
deterministic test session with predictable credentials.

```sql
-- Enable demo mode
INSERT INTO app_settings (key, value) VALUES ('mode', 'demo')
ON CONFLICT (key) DO UPDATE SET value = 'demo';

-- Test session: draft (will be set to live by facilitator in E2E)
INSERT INTO sessions (id, name, start_time, end_time, status, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '[TEST] E2E Session',
  now(),
  now() + interval '3 hours',
  'scheduled',
  'America/New_York'
);

-- Facilitator
INSERT INTO session_participants (session_id, email, display_name, role, password_hash, presentation_order)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'facilitator@test.com', 'Test Facilitator', 'facilitator', 'test123', NULL);

-- Startups (in presentation order)
INSERT INTO session_participants (session_id, email, display_name, role, presentation_order, website_link)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'startup-a@test.com', 'AlphaTech', 'startup', 1, 'https://example.com/alpha'),
  ('00000000-0000-0000-0000-000000000001', 'startup-b@test.com', 'BetaCorp',  'startup', 2, 'https://example.com/beta');

-- Investors
INSERT INTO session_participants (session_id, email, display_name, role, presentation_order)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'investor-1@test.com', 'Investor One', 'investor', NULL),
  ('00000000-0000-0000-0000-000000000001', 'investor-2@test.com', 'Investor Two', 'investor', NULL);
```

---

## Part 2 — Unit tests (Vitest, no browser, no network)

These are cheap and fast. They validate the logic that all higher layers depend on.

### 2.1 `buildStages` — stage construction logic

The `buildStages` function in `src/hooks/useSessionStages.ts` (line 30) is already
pure but not exported. Export it, then test directly.

**Location:** `src/hooks/__tests__/buildStages.test.ts`

```
buildStages()
  ✓ empty startup list → [Intro, Outro] (2 stages)
  ✓ 1 startup → [Intro, Presentation, Q&A, Outro] (4 stages)
  ✓ 3 startups → 8 stages (intro + 3×(pres+qa) + outro)
  ✓ each presentation stage has correct startupIndex
  ✓ each Q&A stage has same startupIndex as preceding presentation
  ✓ intro and outro have no startupIndex (undefined)
  ✓ stage labels include startup display_name
  ✓ falls back to email when display_name is null
  ✓ durations: intro=300s, presentation=300s, qa=180s, outro=300s
```

### 2.2 `useSessionStages` — hook behavior

Use `@testing-library/react`'s `renderHook`.

**Location:** `src/hooks/__tests__/useSessionStages.test.ts`

```
useSessionStages()
  ✓ starts at stage 0, paused
  ✓ next() advances currentStageIndex by 1
  ✓ prev() decrements currentStageIndex by 1
  ✓ next() is no-op at last stage
  ✓ prev() is no-op at stage 0
  ✓ goToStage(n) jumps to stage n and resets remainingSeconds
  ✓ togglePause() flips isPaused
  ✓ activeStartupIndex matches currentStage.startupIndex
  ✓ activeStartupIndex is undefined during intro/outro
```

### 2.3 LiveKit token permissions (Edge Function logic)

The `livekit-token` Edge Function (line 69) sets `canPublish: role !== "investor"`.
This is the server-side enforcement of the "investors never publish video" rule.
It's worth a unit test, but the function uses Deno + `jose` + Supabase client,
making it hard to test in Vitest directly.

**Approach:** Extract the JWT claims construction into a pure function, or test
this rule solely via the E2E layer (investor joins room → verify no `<video>`
element is published from their identity).

---

## Part 3 — Component tests (Vitest + RTL, mocked services)

### 3.0 Setup

```bash
npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Add to `src/test/setup.ts`:
```ts
import '@testing-library/jest-dom'
```

Create the canonical LiveKit mock at `src/test/mocks/livekit.ts`:

```ts
import { vi } from 'vitest'

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useParticipants: vi.fn(() => []),
  useTracks: vi.fn(() => []),
  VideoTrack: ({ trackRef }: any) => (
    <div data-testid={`video-track-${trackRef?.participant?.identity ?? 'unknown'}`} />
  ),
  useLocalParticipant: vi.fn(() => ({ localParticipant: null })),
  RoomAudioRenderer: () => null,
}))

vi.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
}))
```

### 3.1 VideoPane component

**Location:** `src/components/__tests__/VideoPane.test.tsx`

```
VideoPane
  ✓ renders Placeholder when participantIdentity is undefined
  ✓ renders LiveVideoPane when participantIdentity is provided
  ✓ Placeholder shows "Start Call" for facilitator self-pane when idle + not live
  ✓ Placeholder shows "Join Call" for facilitator self-pane when idle + live
  ✓ Placeholder shows "Join Call" for startup self-pane when live
  ✓ Placeholder shows "Waiting for host..." for startup self-pane when not live
  ✓ Placeholder shows spinner when callState is "connecting"
  ✓ "Live" badge appears when isActive is true
  ✓ label and sublabel render correctly
```

### 3.2 Session page layout (role-based rendering)

**Location:** `src/pages/__tests__/Session.test.tsx`

Mock Supabase client to return canned participants. Mock `useLiveKitToken` to
return a token. Import the LiveKit mock from 3.0.

```
Session — facilitator view
  ✓ left pane renders one VideoPane per facilitator (up to 3)
  ✓ center pane renders VideoPane for current startup
  ✓ stage controls visible: Previous, Play/Pause, Next, stage dropdown
  ✓ "End Call" button visible when callState is connected

Session — investor view
  ✓ left pane renders facilitator VideoPanes
  ✓ center pane renders startup VideoPane
  ✓ stage controls NOT visible
  ✓ "Invest" button visible
  ✓ no self-video pane rendered for investor

Session — startup view
  ✓ left pane renders facilitator VideoPanes
  ✓ center pane shows self when startup is active presenter
  ✓ stage controls NOT visible
```

---

## Part 4 — E2E tests (Playwright + local Supabase + local LiveKit)

This is the confidence builder. These tests prove the multi-user, multi-role,
real-time video experience works end-to-end against real services.

### 4.0 Setup

```bash
npm install -D @playwright/test
npx playwright install chromium
```

### 4.1 Playwright config

**Location:** `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,  // multi-user tests must be sequential within a file
  retries: 1,            // WebRTC connections can be flaky; one retry is fair
  timeout: 60_000,       // generous timeout for multi-browser WebRTC setup
  use: {
    baseURL: 'http://localhost:8080',
    permissions: ['camera', 'microphone'],
    trace: 'on-first-retry',
    video: 'on-first-retry',  // record browser video on failure for debugging
  },
  projects: [
    {
      name: 'chromium-fake-media',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npx vite --mode test --port 8080',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
```

**Note:** The `webServer` only starts Vite. Local Supabase and LiveKit must
already be running (via `scripts/test-infra.sh` or manually). Playwright will
fail fast if they aren't — the login flow hits Supabase immediately.

### 4.2 Test helpers

**Location:** `tests/e2e/helpers/auth.ts`

```ts
import { Page, expect } from '@playwright/test'

export async function loginAs(page: Page, opts: {
  email: string
  role: 'investor' | 'startup' | 'facilitator'
  password?: string
  sessionName?: string
}) {
  await page.goto('/login')

  // Wait for session to load (the login page fetches active sessions on mount)
  await expect(page.locator('[data-testid="session-name"]')).toBeVisible({ timeout: 10_000 })

  // Enter email
  await page.fill('#email', opts.email)

  // Click role button to submit
  await page.click(`[data-testid="role-btn-${opts.role}"]`)

  // Facilitator has a password step
  if (opts.role === 'facilitator') {
    await expect(page.locator('#password')).toBeVisible()
    await page.fill('#password', opts.password!)
    await page.click('[data-testid="password-submit-btn"]')
  }

  // Wait for navigation to session page
  await page.waitForURL(/\/session\//, { timeout: 10_000 })
}
```

**Location:** `tests/e2e/helpers/video.ts`

```ts
import { Page, expect } from '@playwright/test'

/**
 * Wait for a real <video> element to appear within a DOM region and be playing.
 * LiveKit renders <video> tags via its VideoTrack component.
 */
export async function expectVideoPlaying(page: Page, selector: string, timeout = 15_000) {
  const videoLocator = page.locator(`${selector} video`)
  await expect(videoLocator).toBeVisible({ timeout })

  // Verify the video is actually receiving frames (not just a black box)
  const isPlaying = await videoLocator.evaluate((el: HTMLVideoElement) => {
    return el.readyState >= 2 && !el.paused && el.videoWidth > 0
  })
  expect(isPlaying).toBe(true)
}

export async function expectNoVideo(page: Page, selector: string) {
  const count = await page.locator(`${selector} video`).count()
  expect(count).toBe(0)
}
```

### 4.3 E2E: Login flows

**Location:** `tests/e2e/login.spec.ts`

Single-browser, no video. Validates auth path against real Supabase.

```
login flows
  ✓ investor logs in with known email → reaches /session/:id
  ✓ startup logs in with known email → reaches /session/:id
  ✓ facilitator logs in with correct password → reaches /session/:id
  ✓ facilitator login fails with wrong password → toast error, stays on login
  ✓ unregistered email → toast error, stays on login
```

### 4.4 E2E: Video call lifecycle (single facilitator)

**Location:** `tests/e2e/videoCall.spec.ts`

Tests the call start/join/end flow. Single browser context — the facilitator.

```
video call lifecycle — facilitator
  setup: login as facilitator@test.com

  ✓ before starting call:
      - facilitator self-pane shows "Start Call" button
      - center pane shows placeholder (no <video> elements)

  ✓ facilitator clicks "Start Call":
      - session status changes to 'live' (verify via Supabase query or UI indicator)
      - facilitator self-pane shows live video (<video> element playing)
      - center pane shows startup video (first startup by default)

  ✓ facilitator clicks "End Call":
      - video panes revert to placeholders
      - session status changes to 'completed'
```

### 4.5 E2E: Multi-user video visibility (the flagship test)

**Location:** `tests/e2e/videoVisibility.spec.ts`

Three browser contexts, each with fake media, each logged in as a different role.
This is the test that builds confidence before going live.

```
video visibility — three-role session

  setup:
    - create 3 browser contexts (all with fake media flags)
    - context A: login as facilitator@test.com (password: test123)
    - facilitator clicks "Start Call" → session goes live
    - context B: login as startup-a@test.com → auto-sees "Join Call", clicks it
    - context C: login as investor-1@test.com → auto-joins as viewer

  wait: all three contexts connected to LiveKit room (allow up to 15s)

  ✓ facilitator context (A):
      - left pane: own video is playing (<video> inside facilitator pane)
      - center pane: AlphaTech video is playing

  ✓ startup context (B):
      - left pane: facilitator video is playing
      - center pane: own video is playing (isSelf)

  ✓ investor context (C):
      - left pane: facilitator video is playing
      - center pane: AlphaTech video is playing
      - no <video> element published FROM investor (verify investor's identity
        does not appear as a video track source in any context)
```

**Implementation notes:**

- The facilitator MUST start the call first (it sets session to `live`). Startup
  and investor join after. Orchestrate this sequentially, not in parallel.
- Investor auto-joins when session status changes to `live` (Session.tsx line 164).
  No button click needed — just wait for the video to appear.
- Use `page.waitForSelector('video', { timeout: 15000 })` generously. WebRTC
  connection + track subscription + rendering takes several seconds with local
  services.
- Chromium's `--use-fake-device-for-media-stream` provides one synthetic animated
  test pattern per context. Each context publishes a visually identical stream,
  but LiveKit routes them correctly by participant identity.

### 4.6 E2E: Stage transitions (facilitator-only, local state)

**Location:** `tests/e2e/stageFlow.spec.ts`

**Important architectural note:** Stage state is currently local React state in
`useSessionStages`. It is NOT synced via Supabase Realtime. When the facilitator
clicks "Next", only their browser advances. Other participants stay on their own
stage. This means we can only test stage transitions from the facilitator's
perspective.

```
stage flow — facilitator perspective
  setup: login as facilitator, start call

  ✓ initial state: stage label shows "Stage 1 — Introduction"
  ✓ Previous button is disabled at first stage
  ✓ click Next → label changes to "Stage 2 — AlphaTech Presentation"
  ✓ center pane identity switches to startup-a@test.com video
  ✓ click Next → "Stage 3 — AlphaTech Q&A" (center pane stays on AlphaTech)
  ✓ click Next → "Stage 4 — BetaCorp Presentation"
  ✓ center pane switches to startup-b@test.com video
  ✓ click Previous → returns to "Stage 3 — AlphaTech Q&A"
  ✓ center pane switches back to startup-a@test.com video
  ✓ navigate to last stage → Next button is disabled
  ✓ Pause/Play toggle works (verify timer stops/resumes)
  ✓ stage dropdown lists all 6 stages; selecting one jumps directly to it
```

> **Future work:** To make stage transitions visible to all participants, the
> current stage index needs to be persisted to Supabase (e.g., a `current_stage`
> column on `sessions`) and subscribed to via Realtime. Once implemented, add
> cross-browser stage sync assertions to the multi-user test in 4.5.

### 4.7 E2E: Investment flow (real-time, multi-user)

**Location:** `tests/e2e/investment.spec.ts`

```
investment flow
  setup: facilitator starts call, startup-a and investor-1 join

  ✓ investor sees "Invest" button during presentation/Q&A stages
  ✓ investor clicks Invest → pledge dialog opens
  ✓ investor submits pledge → funding meter updates on investor's screen
  ✓ funding meter update appears on facilitator's screen (Supabase Realtime)
  ✓ funding meter update appears on startup's screen (Supabase Realtime)
```

### 4.8 E2E: Chat (real-time, multi-user)

**Location:** `tests/e2e/chat.spec.ts`

```
live chat
  setup: facilitator starts call, startup-a and investor-1 join

  ✓ facilitator sends message → appears in all three contexts
  ✓ startup sends message → appears in all three contexts
  ✓ investor sends message → appears in all three contexts
  ✓ messages show sender name and role badge
```

---

## Part 5 — `data-testid` attributes to add

The E2E tests need stable selectors. The login page currently uses `id="email"`
and `id="password"` but role buttons have no testids. Add these:

| Component | Element | `data-testid` |
|---|---|---|
| **Login.tsx** | Session name display | `session-name` |
| | Role button (per role) | `role-btn-{role}` |
| | Password submit ("Continue") | `password-submit-btn` |
| **Session.tsx** | Facilitator video pane container | `facilitator-pane-{email}` |
| | Center/main video pane | `main-video-pane` |
| | Stage label text | `stage-label` |
| | Previous button | `stage-prev-btn` |
| | Play/Pause button | `stage-playpause-btn` |
| | Next button | `stage-next-btn` |
| | End Call button | `end-call-btn` |
| | Invest button | `invest-btn` |
| **StageSelector** | Dropdown trigger | `stage-dropdown` |
| **ChatPanel** | Message input | `chat-input` |
| | Send button | `chat-send-btn` |
| | Message list container | `chat-message-list` |
| **FundingMeter** | Meter bar | `funding-meter-bar` |
| **InvestDialog** | Amount input | `invest-amount-input` |
| | Confirm button | `invest-confirm-btn` |

---

## Implementation order

### Phase 1 — Infrastructure (do this first, everything depends on it)

1. Install local Supabase CLI and verify `supabase start` works with existing
   migrations and Edge Functions.
2. Install local LiveKit server and verify `livekit-server --dev` starts.
3. Create `.env.test` and `supabase/.env.local` with local service URLs/keys.
4. Create `tests/fixtures/seed.sql` with the test session data.
5. Create `scripts/test-infra.sh`.
6. **Manual smoke test:** Run the app against local services. Open browser,
   log in as facilitator, start call, verify video appears. This single manual
   test validates the entire infrastructure stack before writing any automated
   tests.

### Phase 2 — Unit tests (fast wins, validate logic)

7. Export `buildStages` from `useSessionStages.ts`.
8. Write `buildStages` unit tests.
9. Install RTL, write `useSessionStages` hook tests.

### Phase 3 — E2E foundation

10. Install Playwright, create `playwright.config.ts`.
11. Add `data-testid` attributes to Login.tsx and Session.tsx.
12. Write E2E helpers (`auth.ts`, `video.ts`).
13. Write login flow E2E tests (4.3) — single browser, no video, proves auth
    works against local Supabase.

### Phase 4 — The confidence builder

14. Write single-facilitator video lifecycle test (4.4).
15. Write the flagship multi-user video visibility test (4.5).
16. Write stage transition test (4.6).

### Phase 5 — Remaining E2E + component tests

17. Investment flow E2E (4.7).
18. Chat E2E (4.8).
19. Component tests with mocked services (Part 3) — these become regression
    tests once the E2E tests prove the real flows work.

---

## Appendix: Known limitations and future work

### Stage sync is local-only

`useSessionStages` manages stage state in React `useState`. There is no Supabase
persistence or Realtime sync. This means:
- Only the facilitator's stage transitions are meaningful
- Other participants each run their own independent timer
- The "active startup" in the center pane may differ across participants

**Fix:** Add a `current_stage_index` column to `sessions`, update it on
facilitator transitions, subscribe via Realtime in all clients. This is a
prerequisite for cross-browser stage assertions in E2E tests.

### Investor video suppression is enforced at two levels

1. **Server-side:** `livekit-token` Edge Function sets `canPublish: false` for
   investors (line 69). LiveKit SFU rejects any publish attempt.
2. **Client-side:** Session.tsx line 374-375 sets `video={false} audio={false}`
   for investors on the `<LiveKitRoom>` component.

Both are testable: the E2E test verifies no `<video>` track from the investor
identity appears in any context.

### LiveKit CLI for manual multi-stream testing

For debugging layout with multiple distinct video streams when only one camera
is available, use the LiveKit CLI to inject synthetic participants:

```bash
lk room join \
  --url ws://localhost:7880 \
  --api-key <key> --api-secret <secret> \
  --identity startup-a@test.com \
  --publish-demo \
  session-00000000-0000-0000-0000-000000000001
```

This injects a demo video stream as if that participant were publishing. Useful
for testing the facilitator's view of multiple startups without needing multiple
real browsers.
