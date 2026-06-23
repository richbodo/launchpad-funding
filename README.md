# FundFlow — Real-Time Funding Platform

> **Remixing this on Lovable?** Jump to **[Remix Quickstart](#remix-quickstart)** — you only need ~5 minutes plus a free LiveKit account to have your own copy running.

## Remix Quickstart

This app is built on [Lovable](https://lovable.dev) with **Lovable Cloud** (Supabase under the hood) for the database, auth, edge functions, and storage, and **LiveKit** for live video. When you click **Remix** on Lovable, you get a fresh copy of the codebase wired to your own brand-new Lovable Cloud project — every migration auto-applies and every edge function auto-deploys.

What's left to do as the new owner:

### 1. Bootstrap your facilitator account

Open `/admin` in your remixed app. The first time it loads — with zero facilitator accounts in the database — you'll see a **first-run setup screen** that asks for an email, password, and display name. Submit it; you become the first facilitator and are logged in immediately. A placeholder "My First Session" is created so you can start adding participants right away (rename, reschedule, or delete it from the admin panel).

The bootstrap screen self-disables the moment a facilitator exists, so this can only be used by the first person to claim the app — not by random visitors later.

### 2. Configure LiveKit (required for video)

LiveKit is the only external service you need. Without it, chat / scheduling / investments still work, but the video panes stay dark. Follow **[docs/livekit-setup.md](docs/livekit-setup.md)** — it walks you through:

- Signing up for [LiveKit Cloud](https://cloud.livekit.io) (free tier is enough for evaluation)
- Copying your API key, API secret, and WebSocket URL
- Pasting them into Lovable as project secrets (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WS_URL`) and as a frontend env var (`VITE_LIVEKIT_WS_URL`)

A yellow banner on `/admin` reminds you to do this until `VITE_LIVEKIT_WS_URL` is set.

### 3. Configure email (optional, but recommended)

By default, Lovable sends invitation / commitment emails from a generic Lovable sender. For a polished demo day you'll probably want emails to come from your own domain. See **[docs/email-setup.md](docs/email-setup.md)** for the ~5-minute setup, which includes adding a couple of **NS records at your DNS provider** so Lovable can manage SPF / DKIM / DMARC for your sender subdomain automatically.

You can skip this for evaluation and turn it on later — nothing in the app depends on a custom email domain to function.

### 4. (Optional) Try Demo Mode first

Want to see what the app looks like fully populated before you build a real session? In **Admin → Settings**, toggle **Demo Mode**. This seeds three `[DEMO]`-prefixed sessions and a roster of demo participants you can log in as from `/demo-logins`. Toggling demo mode off cleans the demo data back up.

### 5. (Optional) Make it yours

- License is GPL — see [LICENSE.md](LICENSE.md). Forks and modifications are welcome; the same terms apply.
- Hide the "Edit with Lovable" badge from **Publish settings** when you're ready to share publicly (Lovable Pro plan or higher).
- Rebrand colors / typography in `src/index.css` and `tailwind.config.ts` — the rest of the UI uses semantic tokens.

### Running locally (optional)

You don't need a local dev setup to run or modify this app — Lovable's in-browser preview is enough. If you'd rather work locally (use your own editor, run the test suite, etc.), see **[docs/dev_setup.md](docs/dev_setup.md)**. It covers Colima / Docker, the Supabase CLI, LiveKit, and the test infrastructure scripts.

---

## Summary



This is a real-time, browser-based funding platform designed for demo-day-style events where startups or charitable projects present to investors or donors and financing rounds can complete in minutes instead of what often takes years.  

## How it works

A facilitator manages live sessions, controls the presentation flow for startups, and oversees chat while investors watch startup pitches and pledge funds in real time.  Startups and investors get emails when investments are soft-committed, and they complete their transaction with no middle-man.

This style of fundraising platform has been around, and has been very successful at times, but I couldn't find an OSS version I liked, so here's one. :)

## Developer Demo

The application features a demo mode that is kind of awesome, in which you can try the app locally with fixture video streams and live streams.  It has seeded data for quick evaluation, role-based login (no traditional auth required for investors/startups), and a clean, responsive UI.

[This is a little youtube video that shows the demo mode](https://youtu.be/Pm-bSHjzEvA)

To run demo mode locally yourself, follow [Demo mode (offline dev/test)](docs/dev_setup.md#demo-mode-offline-devtest) in the developer setup guide — it lists `[DEMO]` sessions and lets facilitators log in without a password.


## Features

- **Live funding sessions** — Facilitators create, schedule, and run live pitch events with timed stages that Startups present to and Investors invest in.
- **Timezone-aware scheduling** — Sessions are scheduled in a chosen timezone; start/end times and invitation emails are shown in that zone. A session's name, date, time, and timezone can be edited after it's created.
- **Participant management** — Add investors, startups, and facilitators one at a time, or **bulk-import from a CSV** (with a downloadable template). Set startup presentation order and per-startup metadata (funding goal, due-diligence room link, website).
- **Invitations with send tracking** — Branded invitation emails carry session details, a one-click login link, and a Google Calendar link. Bulk-send to everyone not yet emailed (never double-sends), resend to an individual, and see a **Sent / Not sent** status per participant.
- **Email delivery logs** — A per-message delivery timeline (queued → sent → bounced / complained / etc.) for diagnosing email issues.
- **Editable email templates** — Customize the facilitator contact address and the per-role welcome messages used in invitations.
- **Live chat** — All participants can communicate during sessions via a real-time chat panel while the video session is going, getting all questions answered.
- **Presentation and AV controls** - All the usual controls you expect in a video conferencing app of this kind - present, mute, etc. appropriate for each participant type.
- **Real-time investment tracking** — Investors pledge funds during presentations; a funding meter updates in real time for all participants.
- **Role-based access** — Three distinct roles: Facilitator (admin/host), Startup (presenter), and Investor (viewer/pledger)
- **Session timer & stage control** — Facilitators advance through intro, pitch, Q&A, and outro stages with play/pause/stage-change controls
- **Demo mode** — Toggle demo mode from the admin **Settings** tab to seed sample `[DEMO]` sessions and participants; demo data is cleaned up automatically when you switch back off. Local demo scripts can launch browsers for fixture participants.
- **Randomize login** — In demo mode, quickly log in as a random available participant with one click
- **Chat archiving** — Archive and download chat transcripts (private, facilitator-only access)
- **Responsive design** — Works on desktop and tablet with a 3-pane session layout (facilitator video, startup presentation, chat)

## How to Use

### For Investors

Log in with just your email, watch the startup presentations, ask questions, one click to pledge funds to the currently presenting startup or project. Use the chat panel on the right to ask questions or communicate with other participants.

### For Startups

Log in with your email and click Startup to join the session — your presentation begins when the facilitator advances to your slot. Use the chat panel to engage with investors during your pitch and Q&A.

### For Facilitators

Sign in at `/admin` with your facilitator email and password. The admin panel has four tabs — **Sessions**, **New Session**, **Settings**, and **Email Logs**.

**Create & edit sessions**
- **New Session:** enter a name and date, **pick the timezone first**, then choose start and end times (they're interpreted in that timezone). Overlaps with other *scheduled* sessions are flagged.
- Open a session from the **Sessions** list to **Edit** its name, date, time, or timezone, take it **Go Live**, **End Session**, or delete it.

**Manage participants** (inside a session)
- Add participants one at a time — email, optional display name, and role (facilitators also set a password).
- Or **Bulk add with .csv**: click **Download .csv template** for the column layout (`Investor-Emails`, `Startup-Emails`, `Facilitator-Emails`), fill it in, and upload. The import validates emails, skips anyone already on the session, and auto-assigns startup order, then reports how many were added / already present / invalid.
- Set each startup's **presentation order**, and use the gear icon to edit per-startup **metadata** (funding goal, DD room link, website).

**Invite participants & track sends**
- **Send emails (N)** queues invitations to everyone not yet emailed — re-clicking skips anyone already sent, so it never double-sends.
- Each row shows a **Sent / Not sent** status; use the send icon to send or resend to one participant.
- Invitations include the session date/time (in the session's timezone), a one-click login link, and a Google Calendar link.

**Run the session**
- Take the session **Go Live**, then drive the flow from the session page with the stage controls (Previous / Play-Pause / Next) and the stage selector. **End Session** when you're done.

**Settings tab**
- **Demo Mode** — seed or clear sample `[DEMO]` data (demo facilitator: `facilitator@demo.com` / `demo123`).
- **Email Settings** — edit the facilitator contact address and the per-role welcome messages used in invitations.

**Email Logs tab**
- Review every email's delivery status; click a row for the full **delivery timeline** (queued → sent → delivered / bounced / etc.) to diagnose issues.

**Chat archives**
- From a session, **Archive & Clear Chat** to snapshot and reset the chat; archived transcripts are downloadable and facilitator-only.

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

53 tests covering stage logic, hook behavior, VideoPane states, Session page layout, and Login flows. No infrastructure required — these run against mocks.

### Run E2E tests

E2E tests require Supabase and LiveKit running (via `test-infra.sh` above). Playwright starts the Vite dev server automatically.

```
mac% npx playwright test                                    # all E2E tests
mac% npx playwright test tests/e2e/login.spec.ts            # login flows only
mac% npx playwright test tests/e2e/stageFlow.spec.ts        # stage navigation
mac% npx playwright test tests/e2e/chat.spec.ts             # realtime chat
mac% npx playwright test tests/e2e/investment.spec.ts       # investment + realtime
mac% npx playwright test tests/e2e/funding.spec.ts          # funding meter
mac% npx playwright test tests/e2e/audioControls.spec.ts    # audio mute/unmute
mac% npx playwright test tests/e2e/takeStage.spec.ts        # take stage controls
mac% npx playwright test tests/e2e/sessionStatus.spec.ts    # session lifecycle
mac% npx playwright test tests/e2e/videoCall.spec.ts        # video call lifecycle
mac% npx playwright test tests/e2e/videoVisibility.spec.ts  # multi-role video
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
