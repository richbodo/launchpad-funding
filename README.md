# FundFlow — Real-Time Funding Platform

## Summary

FundFlow (one of the many names LLMs auto-generated for this app) is a real-time, browser-based funding and pitch session platform designed for demo-day-style events where startups present to investors and financing rounds can complete in minutes instead of years. A facilitator manages live sessions, controls the presentation flow, and oversees chat and investments while investors watch startup pitches and pledge funds in real time. The application features a demo mode with seeded data for quick evaluation, role-based login (no traditional auth required for investors/startups), and a clean, responsive UI.

## Features

- **Live funding sessions** — Facilitators create, schedule, and run live pitch events with timed stages
- **Real-time investment tracking** — Investors pledge funds during presentations; a funding meter updates in real time for all participants
- **Role-based access** — Three distinct roles: Facilitator (admin/host), Startup (presenter), and Investor (viewer/pledger)
- **Session timer & stage control** — Facilitators advance through intro, pitch, Q&A, and outro stages with play/pause controls
- **Live chat** — All participants can communicate during sessions via a real-time chat panel
- **Demo mode** — Toggle demo mode from the admin panel to seed sample sessions and participants for testing
- **Randomize login** — In demo mode, quickly log in as a random available participant with one click
- **Admin dashboard** — Facilitators manage sessions, participants, presentation order, metadata (DD room links, websites), and chat archives
- **Chat archiving** — Export and download chat transcripts from completed sessions
- **Demo logins page** — A reference page listing all demo credentials with session times and live status indicators
- **Funding meter** — A prominent, animated progress bar showing total funds raised and per-startup breakdowns
- **Responsive design** — Works on desktop and tablet with a 3-pane session layout (facilitator video, startup presentation, chat)

## How to Use

### For Investors

Log in with just your email, watch the startup presentations, ask questions, one click to pledge funds to the currently presenting startup or project. Use the chat panel on the right to ask questions or communicate with other participants.

### For Startups

Log in with your email and click Startup to join the session — your presentation begins when the facilitator advances to your slot. Use the chat panel to engage with investors during your pitch and Q&A.

### For Facilitators

Log in with your facilitator email and password at `/admin` to create sessions, manage participants, set presentation order, and go live. During a live session, use the stage controls (Previous / Play-Pause / Next) and stage selector to manage the presentation flow.

## Running Tests

### Prerequisites

Complete the developer setup in [docs/dev_setup.md](docs/dev_setup.md) first (Colima, Supabase CLI, LiveKit, psql, npm install).

### Start test infrastructure

```
mac% ./scripts/test-infra.sh
```

This script starts the following services if they aren't already running:

- **Supabase** (via Docker/Colima) — Postgres, Realtime, PostgREST on `localhost:54321`
- **Supabase Edge Functions** — served via `supabase functions serve` with LiveKit secrets loaded from `supabase/.env.local`
- **LiveKit** — WebRTC SFU on `localhost:7880` (runs natively, no Docker)

It also writes `.env.test` and `supabase/.env.local` with the correct credentials, installs npm dependencies if needed, and seeds test data if the test session doesn't exist. The script is idempotent — it skips services that are already running.

To force a full database reset and re-seed:

```
mac% ./scripts/test-infra.sh --seed
```

### Run unit and component tests

```
mac% npm test
```

40 tests covering stage logic, hook behavior, VideoPane states, Session page layout, and Login flows. No infrastructure required — these run against mocks.

### Run E2E tests

E2E tests require Supabase and LiveKit running (via `test-infra.sh` above). Playwright starts the Vite dev server automatically.

```
mac% npx playwright test                                  # all E2E tests
mac% npx playwright test tests/e2e/login.spec.ts          # login flows only
mac% npx playwright test tests/e2e/stageFlow.spec.ts      # stage navigation
mac% npx playwright test tests/e2e/chat.spec.ts           # realtime chat
mac% npx playwright test tests/e2e/investment.spec.ts     # investment + realtime
mac% npx playwright test tests/e2e/videoCall.spec.ts      # video call lifecycle
mac% npx playwright test tests/e2e/videoVisibility.spec.ts # multi-role video
```

The video tests (`videoCall`, `videoVisibility`) additionally require LiveKit to be running.

### Shut down test infrastructure

```
mac% ./scripts/test-infra-stop.sh          # stop services, keep data
mac% ./scripts/test-infra-stop.sh --clean  # stop services, wipe data
```

## License

Copyright © 2026 Rich Bodo. All rights reserved.

This software comes with **absolutely no warranty**. It is licensed under the **GNU General Public License (GPL)**. A copy of the license is included in this repository in the file [LICENSE.md](LICENSE.md).

See the [GNU GPL](https://www.gnu.org/licenses/gpl-3.0.html) for full terms and conditions.
