# FundFlow Test Suite — Implementation Plan

## Context for Claude Code

This document is a handoff spec for building a comprehensive test suite for the
`launchpad-funding` repo. The app is a real-time, browser-based funding pitch
platform built with React + TypeScript + Vite + Supabase + LiveKit. Video
conferencing via LiveKit is **already working** — the constraint is that the
developer only has one physical camera available during development.

### Tech stack summary
- **Frontend:** React + TypeScript, Vite, Tailwind, shadcn/ui
- **Backend/DB:** Supabase (Postgres + Realtime + Auth)
- **Video:** LiveKit (WebRTC, `@livekit/components-react`)
- **Test runner already configured:** Vitest (`vitest.config.ts` exists)
- **E2E target:** Playwright (not yet installed)

### Three roles and their video visibility rules
| Role | Camera captured? | Video shown to others? | When? |
|---|---|---|---|
| **Facilitator** | Yes | Yes — always | All session stages |
| **Startup** | Yes | Yes — only in main panel | Only when facilitator selects them |
| **Investor** | Yes | Never | Never |

The facilitator's video occupies a persistent sidebar pane. The main center panel
shows whichever startup the facilitator has selected. Investors are audio-only
participants from the video perspective.

---

## Guiding architecture principle

Before writing any test, extract track visibility logic into a **pure function**
(or set of pure functions) that takes session state and returns a visibility
descriptor. Example shape:

```ts
// src/lib/videoVisibility.ts

export type Role = 'facilitator' | 'startup' | 'investor'

export interface Participant {
  id: string
  identity: string
  role: Role
}

export interface SessionState {
  participants: Participant[]
  activeStartupId: string | null
}

export interface VisibilityResult {
  facilitatorIds: string[]   // always rendered in sidebar
  mainPanelId: string | null // active startup, or null
  hiddenIds: string[]        // investors + non-active startups
}

export function resolveVisibility(state: SessionState): VisibilityResult
```

All three test layers depend on this function existing. Implement it first.

---

## Layer 1 — Unit Tests (Vitest, no browser, no network)

**Location:** `src/lib/__tests__/videoVisibility.test.ts`

These tests are pure logic with zero dependencies. They run in milliseconds.

### 1.1 Visibility rule tests

```
resolveVisibility()
  ✓ facilitator is always in facilitatorIds
  ✓ investor is always in hiddenIds, never mainPanel or facilitatorIds
  ✓ startup is in hiddenIds when no activeStartupId is set
  ✓ startup is in mainPanelId when their id matches activeStartupId
  ✓ non-active startups remain in hiddenIds when a different startup is active
  ✓ multiple facilitators all appear in facilitatorIds
  ✓ switching activeStartupId moves old startup to hidden, new to mainPanel
  ✓ activeStartupId for an id that doesn't exist in participants → mainPanel null
  ✓ empty participants list → all nulls/empty arrays
```

**Location:** `src/lib/__tests__/sessionStages.test.ts`

Session stage transition logic (extracted from whatever manages stage state):

```
stage transitions
  ✓ intro → pitch on facilitator "Next"
  ✓ pitch → Q&A on facilitator "Next"
  ✓ Q&A → outro on facilitator "Next"
  ✓ cannot advance past outro
  ✓ "Previous" works in reverse through stages
  ✓ pause/play toggles timer without changing stage
  ✓ jumping directly to a stage via dropdown sets correct stage
```

**Location:** `src/lib/__tests__/fundingMeter.test.ts`

Investment pledge logic:

```
funding meter
  ✓ pledge adds to startup's running total
  ✓ funding meter percentage = pledged / goal * 100
  ✓ funding meter caps at 100% when over-pledged
  ✓ multiple investors pledging to same startup aggregate correctly
  ✓ pledges to different startups don't cross-contaminate totals
```

---

## Layer 2 — Component Integration Tests (Vitest + React Testing Library)

**Setup required:** Install `@testing-library/react`, `@testing-library/user-event`,
`@testing-library/jest-dom`. Add `setupFiles` in `vitest.config.ts` pointing to
a setup file that calls `import '@testing-library/jest-dom'`.

**Critical:** Mock the entire LiveKit SDK at the top of each test file that
involves video components. LiveKit uses WebRTC APIs that do not exist in jsdom.

```ts
// Canonical LiveKit mock — put in src/test/mocks/livekit.ts and import where needed
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useParticipants: vi.fn(() => []),
  useTracks: vi.fn(() => []),
  VideoTrack: ({ participant }: { participant: { identity: string } }) => (
    <div data-testid={`video-track-${participant.identity}`} />
  ),
  useLocalParticipant: vi.fn(() => ({ localParticipant: null })),
  RoomAudioRenderer: () => null,
}))
```

### 2.1 SessionView component tests

**Location:** `src/components/__tests__/SessionView.test.tsx`

Test that the session layout renders correctly for each role:

```
SessionView — facilitator perspective
  ✓ renders facilitator video pane
  ✓ renders main panel with active startup's video when one is selected
  ✓ renders empty/placeholder main panel when no startup is selected
  ✓ renders stage control buttons (Previous, Play/Pause, Next)
  ✓ renders chat panel
  ✓ does NOT render any investor video panes

SessionView — investor perspective
  ✓ renders facilitator video pane
  ✓ renders main panel with active startup when one is selected
  ✓ does NOT render stage controls
  ✓ renders invest button
  ✓ does NOT render any video pane for the investor themselves

SessionView — startup perspective
  ✓ renders facilitator video pane
  ✓ renders self in main panel when they are the active startup
  ✓ renders placeholder when they are NOT the active startup
  ✓ does NOT render stage controls
```

### 2.2 Facilitator stage controls

**Location:** `src/components/__tests__/StageControls.test.tsx`

```
StageControls
  ✓ clicking Next calls onAdvanceStage
  ✓ clicking Previous calls onRetreatStage
  ✓ Next is disabled on final stage
  ✓ Previous is disabled on first stage
  ✓ Play/Pause toggles and calls onToggleTimer
  ✓ stage dropdown renders all stages
  ✓ selecting a stage from dropdown calls onJumpToStage with correct stage id
```

### 2.3 Startup selector (facilitator selects who presents)

**Location:** `src/components/__tests__/StartupSelector.test.tsx`

```
StartupSelector
  ✓ renders list of startups in correct order
  ✓ clicking a startup calls onSelectStartup with that startup's id
  ✓ currently active startup is visually indicated (aria-current or data-active)
  ✓ drag-and-drop reorder calls onReorder with new order array
```

### 2.4 Funding meter

**Location:** `src/components/__tests__/FundingMeter.test.tsx`

```
FundingMeter
  ✓ shows 0% when no pledges
  ✓ updates percentage correctly as pledges come in (use mock Supabase realtime)
  ✓ shows per-startup breakdown
  ✓ animates smoothly (check that CSS transition class is applied)
```

### 2.5 Login / role selection

**Location:** `src/components/__tests__/LoginPage.test.tsx`

```
LoginPage
  ✓ renders three role buttons: Investor, Startup, Facilitator Admin
  ✓ submitting investor email routes to investor session view
  ✓ submitting startup email routes to startup session view
  ✓ invalid email shows error state
  ✓ demo mode randomize button fills in a random credential
  ✓ facilitator requires password field; investor and startup do not
```

---

## Layer 3 — End-to-End Tests (Playwright)

### Setup

**Install:**
```bash
npm install -D @playwright/test
npx playwright install chromium
```

**`playwright.config.ts`** — critical settings:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // multi-user tests must run sequentially within a file
  use: {
    baseURL: 'http://localhost:5173',
    // Grant camera/mic permission silently
    permissions: ['camera', 'microphone'],
  },
  projects: [
    {
      name: 'chromium-with-fake-media',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',      // skips browser permission dialog
            '--use-fake-device-for-media-stream',  // provides synthetic camera/mic
            // Optional: inject a specific .y4m file per context (see note below)
            // '--use-file-for-fake-video-capture=./tests/fixtures/test.y4m',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
})
```

**Note on multiple distinct video streams:** Chrome's `--use-fake-device-for-media-stream`
provides a single synthetic animated test pattern. Each browser context launched
with this flag will stream the same pattern. To make streams visually distinct
(useful for debugging layout), you can pass `--use-file-for-fake-video-capture=`
with different `.y4m` files per context. Sample Y4M files (4:2:0 chroma only)
are available at `http://media.xiph.org/video/derf/`. Convert any video with:

```bash
ffmpeg -i input.mp4 -pix_fmt yuv420p tests/fixtures/stream-a.y4m
ffmpeg -i input.mp4 -vf "drawtext=text='STARTUP':fontsize=60:x=100:y=100" \
  -pix_fmt yuv420p tests/fixtures/stream-startup.y4m
```

### Shared helpers

**Location:** `tests/e2e/helpers/auth.ts`

```ts
import { Page } from '@playwright/test'

export async function loginAs(page: Page, opts: {
  email: string
  role: 'investor' | 'startup' | 'facilitator'
  password?: string
}) {
  await page.goto('/login')
  await page.fill('[data-testid="email-input"]', opts.email)
  if (opts.role === 'facilitator') {
    await page.fill('[data-testid="password-input"]', opts.password!)
    await page.click('[data-testid="facilitator-login-btn"]')
  } else {
    await page.click(`[data-testid="${opts.role}-login-btn"]`)
  }
  await page.waitForURL('/session/**')
}
```

**Location:** `tests/e2e/helpers/multiUser.ts`

```ts
import { Browser, BrowserContext } from '@playwright/test'

// Spin up N browser contexts, each with fake media
export async function createMultiUserSession(browser: Browser, count: number) {
  return Promise.all(
    Array.from({ length: count }, () =>
      browser.newContext({
        permissions: ['camera', 'microphone'],
      })
    )
  )
}
```

### 3.1 Login flow tests

**Location:** `tests/e2e/login.spec.ts`

```
login flows
  ✓ investor can log in and reaches session view
  ✓ startup can log in and reaches session view
  ✓ facilitator can log in with correct password and reaches admin session view
  ✓ facilitator login fails with wrong password
  ✓ unknown email shows appropriate error
  ✓ demo mode randomize fills investor credential and logs in
  ✓ demo mode randomize fills startup credential and logs in
```

### 3.2 Role-based video visibility (multi-browser)

**Location:** `tests/e2e/videoVisibility.spec.ts`

This is the core E2E test. Spawns three browser contexts simultaneously.

```
video visibility — multi-user session

setup: facilitator logs in, startup-1 logs in, investor-1 logs in
all three are in the same live session room

  ✓ before facilitator selects anyone:
      - facilitator context: facilitator video pane is visible
      - facilitator context: main panel shows placeholder
      - investor context: facilitator video pane is visible
      - investor context: main panel shows placeholder
      - investor context: no investor video pane rendered

  ✓ facilitator selects startup-1:
      - facilitator context: main panel now shows startup-1 video
      - startup-1 context: main panel shows own video
      - investor context: main panel shows startup-1 video
      - investor context: still no investor video pane

  ✓ facilitator selects startup-2 (while startup-1 is still connected):
      - startup-1 context: main panel reverts to placeholder
      - startup-2 context: main panel shows own video
      - investor context: main panel shows startup-2 video

  ✓ facilitator deselects all (if supported):
      - all contexts: main panel shows placeholder
```

### 3.3 Session stage flow (facilitator control)

**Location:** `tests/e2e/sessionFlow.spec.ts`

Single facilitator browser, checks stage transitions:

```
session stage flow
  ✓ session starts in intro stage; timer visible
  ✓ facilitator clicks Next → advances to pitch stage
  ✓ facilitator clicks Next → advances to Q&A stage
  ✓ facilitator clicks Next → advances to outro stage
  ✓ Next button is disabled in outro stage
  ✓ facilitator clicks Previous from Q&A → returns to pitch
  ✓ stage change is reflected in investor and startup contexts (Supabase realtime)
  ✓ facilitator pauses timer → timer stops; play resumes it
```

### 3.4 Investment pledge flow

**Location:** `tests/e2e/investment.spec.ts`

```
investment flow
  ✓ investor sees Invest button when a startup is presenting
  ✓ investor clicks Invest → pledge dialog appears
  ✓ investor confirms pledge → funding meter updates in real time
  ✓ funding meter update is visible to all participants (check facilitator and startup contexts)
  ✓ investor cannot pledge when no startup is selected (button disabled or absent)
  ✓ multiple investors pledging → amounts aggregate on meter
```

### 3.5 Chat

**Location:** `tests/e2e/chat.spec.ts`

```
live chat
  ✓ facilitator can send a message; investor sees it in real time
  ✓ startup can send a message; facilitator and investor see it
  ✓ investor can send a message
  ✓ messages show correct sender name and role badge
  ✓ chat is scrollable when messages overflow
```

### 3.6 Admin / facilitator setup flows

**Location:** `tests/e2e/admin.spec.ts`

```
admin dashboard
  ✓ facilitator can create a new session
  ✓ facilitator can add a startup to a session
  ✓ facilitator can reorder startups via drag-and-drop
  ✓ facilitator can mark session as live
  ✓ facilitator can archive chat transcript (download triggered)
  ✓ demo mode toggle seeds sample participants
```

---

## Layer 4 — Supplementary: LiveKit CLI smoke tests (manual / dev loop)

These are not automated — they are manual commands to run during development
to verify the real WebRTC plumbing before relying on Playwright.

**Prerequisites:** Install the LiveKit CLI (`lk`). Authenticate against your
LiveKit Cloud project or local dev server.

```bash
# Inject a looping demo video as "startup-bot" into your dev room
lk room join \
  --url $LIVEKIT_WS_URL \
  --api-key $LIVEKIT_API_KEY \
  --api-secret $LIVEKIT_API_SECRET \
  --identity startup-bot-1 \
  --publish-demo \
  your-dev-room-name

# Inject a second distinct bot as "startup-bot-2" in a new terminal
lk room join \
  --url $LIVEKIT_WS_URL \
  --api-key $LIVEKIT_API_KEY \
  --api-secret $LIVEKIT_API_SECRET \
  --identity startup-bot-2 \
  --publish-demo \
  your-dev-room-name

# For a custom video file (e.g. a slide deck video):
lk room join \
  --url $LIVEKIT_WS_URL \
  --api-key $LIVEKIT_API_KEY \
  --api-secret $LIVEKIT_API_SECRET \
  --identity startup-bot-3 \
  --publish path/to/video.ivf \
  --publish path/to/audio.ogg \
  your-dev-room-name
```

Use these bots while you are logged into the app as the facilitator. Select each
bot identity from the startup selector to verify the main panel switches correctly.

---

## Implementation order for Claude Code

Work through layers in this order. Each layer adds confidence without depending
on the next.

1. **Extract `resolveVisibility()` and stage logic into pure functions** if not
   already done. Add to `src/lib/`. This is a prerequisite for all tests.

2. **Layer 1 unit tests** — add vitest tests for the pure functions. Should pass
   immediately if the logic is correct.

3. **RTL setup** — install `@testing-library/react`, configure `vitest.config.ts`
   with `environment: 'jsdom'` and `setupFiles`. Write the canonical LiveKit mock
   in `src/test/mocks/livekit.ts`.

4. **Layer 2 component tests** — implement in the order listed above. The
   `SessionView` tests are highest value; start there.

5. **Playwright setup** — install Playwright, create `playwright.config.ts`,
   create the shared helper files.

6. **Layer 3 E2E: login flows first** — these don't require multi-browser and
   prove the auth path works.

7. **Layer 3 E2E: `videoVisibility.spec.ts`** — this is the flagship test.
   It requires the fake media flags and multi-browser contexts. Implement last
   because it has the most dependencies.

8. **Remaining E2E specs** in any order.

---

## Notes on `data-testid` attributes

The E2E tests assume `data-testid` attributes on key elements. As part of
implementation, add these to the relevant components:

| Element | `data-testid` |
|---|---|
| Email input on login page | `email-input` |
| Password input on login page | `password-input` |
| Investor login button | `investor-login-btn` |
| Startup login button | `startup-login-btn` |
| Facilitator login button | `facilitator-login-btn` |
| Facilitator video pane | `facilitator-video-pane` |
| Main panel (center) | `main-panel` |
| Main panel video track | `main-panel-video` |
| Placeholder when no startup selected | `main-panel-placeholder` |
| Startup selector item (per startup) | `startup-selector-{id}` |
| Stage Next button | `stage-next-btn` |
| Stage Previous button | `stage-prev-btn` |
| Stage Play/Pause button | `stage-playpause-btn` |
| Stage dropdown | `stage-dropdown` |
| Invest button | `invest-btn` |
| Funding meter bar | `funding-meter-bar` |
| Chat input | `chat-input` |
| Chat send button | `chat-send-btn` |
| Chat message list | `chat-message-list` |
