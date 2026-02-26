

## Facilitator Session Controls

The current session page has minimal facilitator controls — just Previous/Next buttons to cycle through startups, a hardcoded "Presentation" phase label, and a timer set to an arbitrary 5 minutes from page load. There's no concept of session stages (intro, per-startup presentation + Q&A, outro), no pause/play, and no stage-selection UI.

### Stage Model

The session is a linear sequence of stages, built dynamically from the participant list:

```text
Stage 1: Introduction (5 min) — facilitator
Stage 2: StartupA Presentation (5 min)
Stage 3: StartupA Q&A (3 min)
Stage 4: StartupB Presentation (5 min)
Stage 5: StartupB Q&A (3 min)
...
Stage N: Outro (5 min) — facilitator
```

This will be computed client-side from the `startups` array. No database changes needed — the stage is local facilitator state (other participants see the effect via realtime startup index changes and phase labels).

### Plan

**1. Create `src/hooks/useSessionStages.ts`** — a custom hook that:
- Takes the `startups` array as input
- Computes the full ordered stage list (intro → per-startup presentation/Q&A pairs → outro), each with a label, duration in seconds, and type
- Tracks `currentStageIndex`, `isPaused`, `remainingSeconds`
- Exposes: `currentStage`, `stages`, `isPaused`, `remaining`, `next()`, `prev()`, `goToStage(index)`, `togglePause()`
- Manages a `setInterval` countdown that respects pause state
- Auto-advances to the next stage when the timer hits zero (or stops at outro end)

**2. Create `src/components/StageSelector.tsx`** — a dialog/sheet component:
- Shows a scrollable list of all stages with clear labels like "Stage 3 — AcmeCo Q&A (3 min)"
- Highlights the current stage
- Each row has a "Jump to Stage" button
- Opens from a "Select Stage" button in the facilitator controls area

**3. Update `src/components/SessionTimer.tsx`**:
- Accept `isPaused` and `remainingSeconds` props (driven by the hook) instead of computing its own countdown
- Display the phase name and formatted time as before

**4. Update `src/pages/Session.tsx`**:
- Use the new `useSessionStages` hook
- Replace the hardcoded `currentPhase="Presentation"` and dummy `phaseEndTime` with values from the hook
- Replace the current Previous/Next buttons with the new facilitator control bar:
  - **Stage name label** displayed prominently above the buttons (e.g., "Stage 3 — AcmeCo Q&A")
  - **Previous / Next** buttons (kept as-is, but wired to `prev()` / `next()` from the hook)
  - **Pause/Play** toggle button
  - **Select Stage** button that opens the `StageSelector` dialog
- Sync `currentStartupIndex` with the hook's current stage (derive which startup is active from the stage type)
- Non-facilitator users still see the timer and stage name but not the controls

### Technical Details

**`useSessionStages` hook shape:**
```typescript
interface Stage {
  label: string;        // e.g. "AcmeCo Presentation"
  fullLabel: string;    // e.g. "Stage 4 — AcmeCo Presentation"
  type: 'intro' | 'presentation' | 'qa' | 'outro';
  durationSeconds: number;
  startupIndex?: number; // which startup this stage relates to
}
```

The hook manages a `useRef` interval and `useState` for `currentStageIndex`, `remainingSeconds`, and `isPaused`. When `togglePause()` is called, it simply sets `isPaused` which causes the interval to skip decrementing. `goToStage(i)` sets the index and resets `remainingSeconds` to that stage's duration.

**Files created:**
- `src/hooks/useSessionStages.ts`
- `src/components/StageSelector.tsx`

**Files modified:**
- `src/components/SessionTimer.tsx` — switch from self-managed countdown to prop-driven display
- `src/pages/Session.tsx` — integrate hook, add facilitator control bar with stage name, pause/play, and stage selector

**No database migration needed.** Stage state is local to the facilitator's browser. Other participants see the effect through the existing startup index and phase label rendering.

