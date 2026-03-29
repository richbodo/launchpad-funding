# Session Layout Behavior (Desktop)

This document describes the three-pane session layout on desktop and how
each pane behaves across the session lifecycle. The center pane is
referred to as **"the stage"** throughout this document and in the
codebase. Mobile layout is not covered here and will be addressed
separately.

---

## Three-pane layout

```
+------------------+-----------------------------+------------------+
|                  |                             |                  |
|   LEFT PANE      |       CENTER PANE           |   RIGHT PANE     |
|   Facilitators   |    Startup Presentation     |      Chat        |
|   (up to 3)      |                             |                  |
|                  |                             |                  |
+------------------+-----------------------------+------------------+
```

- **Left pane** (fixed width ~280-320px): Facilitator video streams,
  stacked vertically. Up to 3 facilitators, each getting an equal share
  of the vertical space.
- **Center pane / "the stage"** (flexible, fills remaining width): The
  main content area. Shows the active startup's video during
  presentation/Q&A stages. During intro/outro, a facilitator can "Take
  Stage" to mirror their video here; otherwise shows a placeholder.
- **Right pane** (fixed width ~320-384px): Live chat panel.

---

## Session stages

A session progresses through these stages in order:

| # | Stage | Type | Duration | Center pane shows |
|---|-------|------|----------|-------------------|
| 1 | Introduction | `intro` | 5 min | Facilitator video (if taken stage) or placeholder |
| 2 | Startup A Presentation | `presentation` | 5 min | Startup A video |
| 3 | Startup A Q&A | `qa` | 3 min | Startup A video |
| 4 | Startup B Presentation | `presentation` | 5 min | Startup B video |
| 5 | Startup B Q&A | `qa` | 3 min | Startup B video |
| ... | (repeat for each startup) | | | |
| N | Outro | `outro` | 5 min | Facilitator video (if taken stage) or placeholder |

The facilitator advances through stages via Next/Previous controls.
Stage state is local to the facilitator's browser (not synced via
Supabase).

---

## Left pane: Facilitator videos

### How facilitators appear

The left pane renders one `VideoPane` per facilitator registered in the
`session_participants` table for this session (up to 3). The panes are
stacked vertically, each taking an equal share of the available height.

| Facilitators in session | Layout |
|------------------------|--------|
| 1 | Single pane, full height |
| 2 | Two panes, each 50% height |
| 3 | Three panes, each 33% height |

### Pane states

Each facilitator pane shows one of:

- **"Start Call" button** — The logged-in facilitator's own pane, before
  the call has started (session not yet live). Only the facilitator sees
  this on their own pane.
- **"Join Call" button** — The logged-in facilitator's own pane when the
  session is already live (e.g., another facilitator started it).
- **Live video** — After the call is started/joined, shows the
  facilitator's camera feed (or synthetic stream in the demo).
- **Placeholder with spinner** — A facilitator who is registered but
  hasn't joined the call yet, or whose video track hasn't been received.
- **Placeholder with video icon** — A facilitator who is registered but
  the call hasn't started yet.

### When facilitators join/leave

- When a new facilitator joins the LiveKit room (publishes a camera
  track), their pane transitions from placeholder/spinner to live video.
- When a facilitator leaves (disconnects from LiveKit), their pane
  reverts to the placeholder state.
- The pane itself (the slot in the left column) is always present as
  long as the facilitator is registered in the session — it does not
  appear/disappear based on connection state.

---

## Center pane: Startup presentation

### During intro stage

No startup is presenting during the introduction. The
`activeStartupIndex` is `undefined` during intro.

If a facilitator has clicked **"Take Stage"**, the stage shows that
facilitator's video with an "On Stage" sublabel. Otherwise it shows a
placeholder with the "Introduction" label.

### During presentation stages

The center pane shows the active startup's video. The startup is
determined by the `startupIndex` on the current stage. When the
facilitator clicks Next to advance from one startup's Q&A to the next
startup's Presentation, the center pane switches to the new startup's
video.

### During Q&A stages

Same as presentation — the center pane continues to show the same
startup's video. Q&A is a continuation of the presentation for layout
purposes.

### During outro stage

Same as intro — no startup is presenting. A facilitator can take the
stage, or the placeholder is shown.

### Pane states

- **Live video** — The startup's camera track is being received from
  LiveKit. Shows the video with a "LIVE" badge.
- **Placeholder with spinner ("Joining...")** — The startup is expected
  (their identity is set) but their camera track hasn't been received
  yet. This happens when the startup hasn't joined the call, or when
  the track is still being negotiated.
- **Placeholder (no startup)** — During intro/outro when no startup
  should be presenting and no facilitator has taken the stage.

### Take Stage

During intro and outro stages, each facilitator's left-pane slot shows a
**"Take Stage"** button (visible only when the call is connected). Clicking
it mirrors that facilitator's video to the stage (center pane). The
facilitator's left-pane video continues playing simultaneously.

- Only one facilitator can be on stage at a time. Clicking "Take Stage"
  on a different facilitator replaces the current one.
- The button shows "On Stage" (disabled) for the facilitator currently
  on stage.
- Any facilitator can put any facilitator on stage (including a co-host).
- When the session advances to a presentation or Q&A stage, the stage
  identity is automatically cleared — the startup takes over the center
  pane.
- When returning to intro/outro (via Previous or stage selector), the
  facilitator must explicitly click "Take Stage" again.
- State is local to `Session.tsx` (`stageIdentity`), not synced across
  participants.

---

## Right pane: Chat

The chat panel is always visible and active regardless of stage or call
state. All roles (facilitator, startup, investor) can send and receive
messages. Messages are synced in real time via Supabase Realtime.

---

## Call lifecycle and video visibility

### Before the call starts (session status: scheduled)

| Pane | What shows |
|------|-----------|
| Left (self-facilitator) | "Start Call" button |
| Left (other facilitators) | Placeholder with video-off icon |
| Center | Placeholder with video-off icon |

### After facilitator clicks "Start Call" (session status: live)

| Pane | What shows |
|------|-----------|
| Left (self-facilitator) | Own camera feed |
| Left (other facilitators) | Spinner while connecting, then live video |
| Center | Active startup's video (or spinner if not yet joined) |

### Investors

Investors auto-join as viewers when the session goes live. They do NOT
publish video or audio. Their view is the same 3-pane layout but they
see an "Invest" button instead of stage controls. The Invest button is
disabled during intro/outro stages.

### Startups

Startups see a "Join Call" button in the center pane (when it's their
turn and the session is live). Once they join, their video appears in
the center pane for all participants. Startups publish video and audio.

### After facilitator clicks "End Call" (session status: completed)

All video panes revert to placeholders. Non-facilitator participants are
disconnected automatically.

---

## Known limitations

- **Stage state is local**: Only the facilitator's browser knows which
  stage is active. Other participants each run their own independent
  stage/timer state. A future enhancement will sync stage state via
  Supabase Realtime.

- **Mobile layout**: Not documented here. The current responsive layout
  stacks panes vertically on small screens but has not been tested or
  designed for mobile use.
