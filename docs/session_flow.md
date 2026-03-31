# Session Flow

This document describes the logical flow of a live funding session and
how each role experiences it.

---

## Session lifecycle

A session moves through four statuses: **draft** (created in admin),
**scheduled** (visible on login page), **live** (call in progress),
**completed** (call ended). Only facilitators can transition between
statuses.

## Roles

| Role | Connects by | Publishes video/audio | Controls |
|------|------------|----------------------|----------|
| **Facilitator** | Clicks "Start Call" | Yes | Stage controls, Take Stage, End Call |
| **Startup** | Clicks "Join Video Chat" (when session is live) | Yes | None (passive) |
| **Investor** | Auto-joins when session goes live | No (viewer only) | Invest button (during presentations) |

## Stage sequence

Every session follows this stage sequence, built dynamically from the
registered startups:

1. **Introduction** (5 min) — facilitator addresses the room
2. **Startup A Presentation** (5 min) — first startup presents
3. **Startup A Q&A** (3 min) — audience questions for Startup A
4. *(repeat presentation + Q&A for each startup in order)*
5. **Outro** (5 min) — facilitator wraps up

Each stage has a countdown timer. Timer behavior differs depending on
how a stage is entered:

- **Auto-advance** (timer expires): the session advances to the next
  stage and the new stage's timer starts counting down automatically.
  This is the normal flow when everything is running smoothly.
- **Manual navigation** (Next, Previous, or Stage Selector): the new
  stage's timer resets to its full duration and **pauses**. The
  facilitator must press Play to start it. This gives participants
  settling time after unexpected transitions — e.g., skipping a
  startup that isn't present, or jumping back to revisit a stage.

The facilitator can also pause/resume the timer at any time.

## Desktop layout (3-pane)

```
+-----------------------+-------------------------------+------------------+
|                       |                               |                  |
|   LEFT PANE           |        CENTER PANE            |   RIGHT PANE     |
|                       |      ("the stage")            |                  |
|   Facilitator         |                               |     Live Chat    |
|   video feeds         |   Active participant video    |                  |
|                       |                               |                  |
|   ───────────────     |                               |                  |
|   Startup thumbnails  |   Stage label & timer         |                  |
|   (facilitator only)  |   Facilitator controls        |                  |
|                       |   or Invest button            |                  |
+-----------------------+-------------------------------+------------------+
```

- **Left pane**: Up to 3 facilitator video feeds stacked vertically.
  Below them (facilitator view only), a scrollable list of startup
  thumbnails. Each facilitator and startup has a "Take Stage" button.
- **Center pane**: The main presentation area. Shows the active
  participant's video, plus role-specific controls below.
- **Right pane**: Live chat, visible and usable by all roles at all
  times.

## Center pane ("the stage")

The center pane shows video according to this priority:

1. **Manual override** — if a facilitator has clicked "Take Stage" on
   any participant (facilitator or startup), that participant's video
   is shown with an "On Stage" label. 
2. **Auto-select** — during presentation and Q&A stages, the
   corresponding startup's video is shown automatically.
3. **Placeholder** — during intro/outro with no override, a static
   placeholder with the stage name.

The manual override clears automatically when the stage advances
(Next, Previous, Stage Selector, or timer auto-advance).  Once the stage is entered, however, manual override does work again and can be used by the facilitator.

## Typical session walkthrough

1. Facilitator creates the session in the admin panel, adds
   participants, and sets presentation order.
2. Session is scheduled. Participants see it on the login page.
3. Facilitator logs in and clicks **Start Call**. The session goes
   live. The facilitator's camera feed appears in the left pane.
4. Investors auto-join as viewers. Startups click **Join Video Chat**
   in the header bar to connect with camera and mic.
5. During the **Introduction**, the facilitator clicks "Take Stage"
   on their own name (or a co-facilitator's) to put that feed on the
   center stage for all participants, and introduces the group to the process.  The facilitator also clicks the "play" button to start the introduction timer, which counts down from 5 minutes to zero.
6. After the intro, the facilitator clicks **Next** (or the timer expires) to advance
   to the first startup's **Presentation**. The center pane
   automatically switches to that startup's video.  If a stage timer expires, then the stage auto-advances to the next stage, and the next stage's timer auto plays.  If the facilitator selects a stage, then the timer on that stage does not auto-start, and the facilitator presses play to start that timer.
7. During a presentation, investors can click **Invest** to pledge
   funds. The funding meter at the top updates in real time for all
   participants, adding their pledge to the total amount pledged, up to that startups funding goal.
8. After a startups presentation timer expires, the session auto-advances to **Q&A**. The
   same startup stays on the center stage. Investors can still invest as long as the app is in that stage, whether the timer expires or not.
9. This cycle repeats for each startup.
10. The **Outro** stage works like the introduction — facilitator can
    take the stage to wrap up.
11. The facilitator clicks **End Call**. All participants are
    disconnected. The session moves to completed status.

## Real-time synchronization

All participants see the same stage, timer, and center-pane video at
all times:

- **Stage sync**: The facilitator's stage state (index, pause/play,
  remaining time, and stage override) is broadcast to all participants
  via Supabase Realtime. Non-facilitators apply the received state
  automatically.
- **Late joiners**: Investors who arrive mid-session read the
  facilitator's current state from Realtime Presence on first
  connection and sync immediately.
- **Investments**: New pledges propagate to all participants via
  Realtime and update the funding meter instantly.
- **Chat**: Messages are delivered via Realtime to all participants.

## Facilitator controls

| Control | Effect |
|---------|--------|
| **Start Call** | Sets session to live, connects to video |
| **End Call** | Sets session to completed, disconnects all |
| **Play / Pause** | Starts or stops the stage countdown timer |
| **Next / Previous** | Advances or retreats one stage |
| **Stage Selector** | Jumps directly to any stage |
| **Take Stage** | Puts any participant (facilitator or startup) on the center stage, overriding auto-select until the next stage advance |

## Investor controls

| Control | When available |
|---------|---------------|
| **Invest** | During presentation and Q&A stages only |
| **DD Room** | Always visible (links to due-diligence room) |

## Startup experience

Startups have no stage controls. They join the video call via the
header button, and their camera feed appears on the center stage when
the facilitator reaches their presentation or Q&A stage (or when a
facilitator manually puts them on stage via Take Stage). They can
participate in chat at all times.
