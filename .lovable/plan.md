
# Full Session Simulation Test

A single Vitest integration test that walks an entire live session end-to-end, exercising both the in-app state machine (`buildStages` / stage transitions) and the real backend (sessions, participants, investments, chat). Verifies invariants at checkpoints and a final reconciliation pass.

Not a browser/Playwright test — we don't render the React app. We simulate every actor as a tiny "client" object that owns a Supabase JS client + role/credentials, and we drive the facilitator's stage machine directly via `buildStages` + a local index/timer.

## Files

- **New** `tests/simulation/fullSession.test.ts` — the simulation (Vitest, ~400 lines, single `describe` with one long `it`).
- **New** `tests/simulation/actors.ts` — `Facilitator`, `Startup`, `AccreditedInvestor`, `CommunitySupporter` classes wrapping a Supabase client. Methods: `login()`, `logout()`, `rejoin()`, `postChat(msg)`, `invest(startup, amt)`, `pledge(startup, amt)`, `updateMetadata(patch)`.
- **New** `tests/simulation/harness.ts` — `seedSession()`, `cleanup()`, `assertChatContains()`, `assertFundingTotals()`, `advanceStage()`, time helpers.
- **Edit** `package.json` — add `"test:simulation": "vitest run tests/simulation"`.
- **Edit** `vitest.config.ts` — extend `include` to also pick up `tests/simulation/**`, and add a longer per-test timeout (60s) for this folder via a second project or `testTimeout` override.

## Test scenario (single `it`, ordered checkpoints)

1. **Seed** — `harness.seedSession()` inserts a `[SIM]`-prefixed session with: 1 facilitator (bcrypt password), 3 startups (A, B, C with `presentation_order` 1/2/3, dd/website/funding_goal set), 2 accredited investors, 2 community supporters. Hashing uses the existing `hash_participant_password` trigger.
2. **Join** — every actor calls `participant-login`. Asserts response includes correct `investor_class`. Each actor flips `is_logged_in=true` via the `participant-presence` function. Checkpoint: `session_participants.is_logged_in = true` for all 8 rows.
3. **Build stages** — facilitator calls `buildStages(startups)`. Assert: 8 stages (intro + 3×(presentation+qa) + outro), durations correct.
4. **Intro stage** — verify investors' Invest/Pledge writes are blocked at the *app* level (we don't write — we assert that the facilitator state has `currentStage.type === 'intro'` and the simulation refuses to call `invest()` here, matching the disabled-button rule). All four investors/supporters post a "hello" to chat.
5. **Startup A presentation** — `advanceStage()`. Accredited investor 1 makes 3 separate equity investments ($1k, $5k, $10k). Accredited investor 2 makes 1 equity ($2k) + 1 gift ($50). Community supporter 1 makes 2 gifts ($20, $80). Community supporter 2 logs out mid-stage. Startup A posts a chat message. Checkpoint: 7 investment rows for startup A; `sum(equity)=18000`, `sum(gift)=150`; gift cap respected (none > 100).
6. **Startup A Q&A** — supporter 2 rejoins (`participant-presence` true). Investor 1 attempts a gift of $150 → assert the simulation rejects it client-side via the same `amt <= 100` rule used by `InvestDialog` (no DB write). Investor 1 successfully gifts $100. Facilitator posts chat. Checkpoint: 8 investment rows, supporter 2 `is_logged_in=true`.
7. **Startup B presentation** — startup B updates its metadata (`dd_room_link`, `website_link`, `funding_goal`) via direct row update (admin path; in the live app this is the admin UI). All actors re-fetch participants; assert each sees the new values. Investor 2 invests $25k equity in B. Supporter 1 gifts $40.
8. **Startup B Q&A** — chat burst: each role (facilitator, startup, investor, supporter) posts one message. Checkpoint: chat log contains messages in send order and includes the expected sender_role mix.
9. **Startup C presentation + Q&A** — minimal traffic (1 equity, 1 gift) to confirm the loop generalises.
10. **Outro** — `advanceStage()` to outro. Simulation again refuses new invests/pledges (stage-gate rule). Final chat round of goodbyes.
11. **Final reconciliation** — query DB once and assert:
    - Total `investments` row count matches the running tally maintained by the test.
    - `sum(amount) where pledge_type='equity'` and `'gift'` per startup match expected totals.
    - No gift > 100; no row with invalid `pledge_type`.
    - Chat message count and ordering match the test-side ledger; every actor that posted is represented; sender_role per message is correct.
    - Final `currentStageIndex === stages.length - 1` and `currentStage.type === 'outro'`.
    - `session_logs` contains an `investment` event for each investment (the dialog inserts one — we mirror that insert in `actor.invest()`).
12. **Cleanup** — `afterAll` deletes the `[SIM]` session (cascade removes participants/investments/chat/logs).

## State-machine coverage details

`advanceStage()` mutates a plain `{ index, paused, remainingSeconds }` object using the same transitions as `useSessionStages` (next/prev/goToStage/resetStage). A small unit-level assertion block in the same test verifies: countdown reaching 0 advances to next; advancing past the last stage clamps; `resetStage` restores `durationSeconds` and pauses. This covers the parts of the hook that don't require React.

## Infrastructure details (technical)

- Uses the **anon** key for actor clients (mirrors what the browser uses); seeding/cleanup uses `psql` via the harness pre-checked `PGHOST` (consistent with existing seeded smoke script's PSQL mode). REST-only fallback omitted to keep the test simple — runner just needs the existing `PG*` env.
- `participant-login` is called via `fetch` against `${VITE_SUPABASE_URL}/functions/v1/participant-login` for realism; chat/invest/presence go through the standard client APIs the React components use.
- Per-test timeout: 60s.
- No realtime subscriptions — every assertion is a fresh `SELECT`. Realtime is already covered by Playwright (`investment.spec.ts`).

## Out of scope

- LiveKit video, email queue, archive-chat. Each has its own focused tests; pulling them in would make this a flaky kitchen-sink.
- Browser rendering — the request explicitly accepts this.
