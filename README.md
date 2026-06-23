# FundFlow — Real-Time Funding Platform

## Summary

This is a real-time, browser-based funding platform designed for demo-day-style events where startups or charitable projects present to investors or donors and financing rounds can complete in minutes instead of what often takes years.  

This style of fundraising platform has been around, and has been very successful at times, but I couldn't find an OSS version I liked, so here's one. :)

The reason this type of thing is so effective is that the "discovery" phase where great organizations find great supporters is mostly taken care of by the facilitators of the session - they find great folks that should know about each other and bring them into the event.

## How do you run a session with this

There are features for both accredited investors, and non-accredited investors who cannot pledge more than 100USD, and who get a no-obligation gift from the startup.

The flow is pretty intuitive. You build a session, then a landing page for the event is built.  Email templates for every email that goes out - diagnostics every step of the way - all implemented.

The way the legal stuff works is that the platform will only allow investors to make "soft commitments".  

After that, it emails the investor and the investee with the details of the comittment, and gives strong advisement to perform intensive due dilligence and consult legal before they invest in anything or accept an investment.  

Accredited Investors can offer a commitment to invest in exchange for equity.
Community Supporters can pledge support with up to 100USD gift, but they cannot

Startups can offer a gift in exchange for a pledge, but they can't gaurantee they will deliver on it.  So the gift is a "thank you" that may stay just words or turn into words and an apple pie, whatever you want to offer.  

The platform just enforces the emails and the basic functionality of those features.  The copy of the emails can be edited by the facilitators.

In most cases, the facilitator who picked the startups will be an advocate for the startups.  

The platform consolidates work into finding startups and investors that match, so the facilitator needs to have a way to do that work efficiently, preferrably through their network  But the nice thing about finding all of them entirely through your contact network is that since everyone has been invited by the startups and facilitators communities, it is easy to check references on both sides - everyone has a path to get the v4 on everyone else - it's perfect forward v4.

The absolute best way to make a Real Time Fundraising session work is to first find great organizations that need funding and will crush it with their mission when they get it - and second, get them and the facilitators to invite their communities.  

This is the event description we had for the first event:

"We are bringing together the communities of three NZ tech startups innovating in AI services (Superlyne), Aerospace/drone/evtol (Practical Aircraft ltd), and Online Marketplaces (Sendd).  Each startup will present for 5 minutes, then have 5 minutes for Q&A.  Any attendee can commit to invest as either a community member (max 100USD commitment) or an accredited investor.  With a few jokes in the intro and outro, the entire event take less than an hour, all-in.  Come join for any part of the session.  We are using a new, NZ-grown, free and open-source fundraising tool.  After the event, community members of the startups and facilitators can join a moderated zoom meeting where we can meet and learn from each other, and break out into small zoom rooms based on common interests."

## How it works - we need a users manual

A facilitator adds the startups, investors, and other faciltators to a session, then manages live sessions, controls the presentation flow for startups, and oversees chat while investors watch startup pitches and pledge funds in real time.  Startups and investors get emails when investments are soft-committed, and they complete their transaction with no middle-man.

All video/audio is handled by livekit, so you will want a livekit account to make it work. Free accounts work for small groups, but you will want a paid account for larger groups.

## If you are Remixing on Lovable

This app was created 50% with lovable.dev, and 50% on the command line with claude code.  Lovable is really, really easy to remix and launch an instance with.  There are a few things, like full load tests, that only work on the command line, but it's totally optional to use the app anywhere.  We would absolutely accept contributions that port this to other platforms.

Remixing on lovable, you will need to add your LiveKit secrets at startup.  That's mostly automated.

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
