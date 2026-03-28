# Session Layout Behavior (Desktop)

This document describes the three-pane session layout on desktop and how
each pane behaves across the session lifecycle. Mobile layout is not
covered here and will be addressed separately.

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
- **Center pane** (flexible, fills remaining width): The main content
  area. Shows the active startup's video during presentation/Q&A stages,
  and is empty (placeholder) during intro/outro.
- **Right pane** (fixed width ~320-384px): Live chat panel.

---

## Session stages

A session progresses through these stages in order:

| # | Stage | Type | Duration | Center pane shows |
|---|-------|------|----------|-------------------|
| 1 | Introduction | `intro` | 5 min | Placeholder (no startup presenting) |
| 2 | Startup A Presentation | `presentation` | 5 min | Startup A video |
| 3 | Startup A Q&A | `qa` | 3 min | Startup A video |
| 4 | Startup B Presentation | `presentation` | 5 min | Startup B video |
| 5 | Startup B Q&A | `qa` | 3 min | Startup B video |
| ... | (repeat for each startup) | | | |
| N | Outro | `outro` | 5 min | Placeholder (no startup presenting) |

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

The center pane shows a placeholder. No startup is presenting during the
introduction. The `activeStartupIndex` is `undefined` during intro.

**Current behavior (bug):** The code falls back to `startups[0]` when
`activeStartupIndex` is `undefined` (via `startups[activeStartupIndex ?? 0]`),
so the center pane actually attempts to show the first startup's video
during intro/outro. This should be fixed so that the center pane shows
an empty placeholder during intro/outro stages.

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

The center pane shows a placeholder, same as intro. No startup is
presenting.

### Pane states

- **Live video** — The startup's camera track is being received from
  LiveKit. Shows the video with a "LIVE" badge.
- **Placeholder with spinner ("Joining...")** — The startup is expected
  (their identity is set) but their camera track hasn't been received
  yet. This happens when the startup hasn't joined the call, or when
  the track is still being negotiated.
- **Placeholder (no startup)** — During intro/outro when no startup
  should be presenting.

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

- **Center pane during intro/outro**: Currently falls back to showing
  the first startup instead of an empty placeholder (see bug note above).

- **Mobile layout**: Not documented here. The current responsive layout
  stacks panes vertically on small screens but has not been tested or
  designed for mobile use.
