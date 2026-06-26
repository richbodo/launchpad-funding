## Connection Health & Countermeasures

Implement facilitator-visible connection health with human-in-the-loop nudges. Designed for a facilitator who is *in* the call and focused — at-a-glance summary, one-click drill-in, templated nudges that put the user's environment first.

### Slice A — Facilitator-only Connection Health panel

A new `ConnectionHealthPanel` component, mounted inside `<LiveKitRoom>` on `Session.tsx`, visible only to facilitators.

**Condensed always-on indicator** (top-right of session header, next to existing controls):
- A single pill: `● 5` (green dot + total count) when everyone is healthy
- Turns amber/red and shows worst-case label when any participant degrades: `● 1 issue` or `● 2 issues`
- Click to expand a popover with per-participant rows

**Expanded popover rows** (one per remote participant):
```
● Jack (Startup)      Poor · 240ms · 6% loss · 1 reconnect      [Nudge ▾]
● Emmerich (Investor) Good · 80ms · 0% loss                     —
```
- Dot color from derived health state: `healthy` (green), `degraded` (amber), `failing` (red), `stuck` (red, pulsing)
- Health state derived from `ConnectionQuality` + reconnect events from existing `RoomEventLogger`
- Reconnect count tracked in-memory per identity (resets on session change)

### Slice B — WebRTC stats + Nudge actions

**Stats sampling** (5s interval, in-memory only, no DB writes):
- Use `RTCPeerConnection.getStats()` from each remote participant's track publication
- Extract: RTT, packet loss %, jitter, framesDropped, availableOutgoingBitrate
- Feed into the health state classifier alongside `ConnectionQuality`

**Nudge action menu** (per-row dropdown) — ordered by the user's preferred troubleshooting sequence:
1. **"Plug in AC power"** — DMs a templated chat message: *"Hey {name} — quick check: if you're on a laptop, plug into AC power. Battery mode aggressively throttles Wi-Fi & CPU."*
2. **"Disable VPN"** — DM: *"Hey {name} — try disabling any VPN or corporate proxy. Double-NAT is a common cause of drops."*
3. **"Refresh your video tile"** — runs local `softRetry()` (existing in `VideoPane`); no DM
4. **"Ask them to rejoin"** — DM: *"Hey {name} — could you click Leave Call and then Join Call again? That'll re-establish the connection."*
5. **"Suggest lower quality"** — DM: *"Hey {name} — your network is struggling. Try closing other tabs / pausing downloads."*

All nudges are **suggestions** — they post into the existing `chat_messages` channel with `sender_role: 'facilitator'`. No silent auto-recovery.

### Slice C — Post-session Connection Report

A new tab in `Admin.tsx` under each session: **"Connection Report"**.

Reads from existing `session_logs` (already capturing `livekit_reconnecting` / `livekit_reconnected` from Slice from prior work).

Per-participant summary:
- Total reconnect events
- Total time spent reconnecting (sum of reconnecting → reconnected gaps)
- First/last seen reconnect timestamps

Plus a session-wide rollup ("3 of 7 participants had ≥1 reconnect; worst: Jack with 4 events / 142s offline") to inform tier/region decisions.

### Files to add / change

**New:**
- `src/components/ConnectionHealthPanel.tsx` — pill + popover + rows
- `src/hooks/useConnectionHealth.ts` — sampling loop, classifier, in-memory state map
- `src/lib/connectionNudges.ts` — DM templates + sender helper
- `src/components/__tests__/ConnectionHealthPanel.test.tsx`
- `src/hooks/__tests__/useConnectionHealth.test.ts`

**Changed:**
- `src/pages/Session.tsx` — mount `<ConnectionHealthPanel />` for facilitators only, inside `<LiveKitRoom>`
- `src/pages/Admin.tsx` — add Connection Report tab per session
- `src/test/mocks/livekit.ts` — add `getStats` mock support

No DB migrations needed — `session_logs` already stores reconnect events.

### Out of scope (deliberately)

- No silent auto-recovery (would mask real problems)
- No region switching (LiveKit-side, not app-side)
- No participant-visible self-health UI (facilitator panel only; keeps the room calm)
- No bandwidth caps applied by the app (we *suggest*, user decides)
