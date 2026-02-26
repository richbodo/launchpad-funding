# FundFlow — Real-Time Funding Platform

## Summary

FundFlow (one of the many names LLMs auto-generated for this app) is a real-time, browser-based funding and pitch session platform designed for demo-day-style events where startups present to investors. A facilitator manages live sessions, controls the presentation flow, and oversees chat and investments while investors watch startup pitches and pledge funds in real time. The application features a demo mode with seeded data for quick evaluation, role-based login (no traditional auth required for investors/startups), and a clean, responsive UI.

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

## Status

**Front-end demo: Complete.** The UI, session flow, admin tools, and demo mode are fully functional.  This was vibe-coded so far.

### Next Steps

- **Email and Calendar Integration** - this is how the app is going to notify folks - just adding an email to a session auto-white lists and automates notifications and calendaring. 
- **Video conferencing integration** — Plug in a video provider (e.g., Daily, Twilio, or LiveKit) to replace the placeholder video panes with real streams.
- **Test suite** — Build comprehensive unit, integration, and end-to-end tests covering login flows, session lifecycle, investment logic, chat, and admin operations.


## How to Use

### For Investors

1. Navigate to the login page (the app redirects there automatically)
2. Enter your registered email address
3. Click the **Investor** button to join the active session
4. Once in the session, watch the startup presentations in the center pane
5. Click the **Invest** button to pledge funds to the currently presenting startup
6. Use the chat panel on the right to ask questions or communicate with other participants
7. In demo mode, you can click **randomize** under the Investor button to log in as a random available investor

### For Startups

1. Navigate to the login page
2. Enter your registered email address
3. Click the **Startup** button to join the session
4. Your presentation will begin when the facilitator advances to your slot in the presentation order
5. Use the chat panel to engage with investors during your pitch and Q&A
6. In demo mode, click **randomize** under the Startup button for quick access

### For Facilitators

1. Navigate to the login page and click **Facilitator Admin →** at the bottom, or go directly to `/admin`
2. Log in with your facilitator email and password
3. From the admin dashboard you can:
   - **Create sessions** — Set name, date, start/end times, and timezone
   - **Manage participants** — Add investors, startups, and other facilitators to a session
   - **Set presentation order** — Drag startups into the desired pitch sequence
   - **Go live** — Change a session's status to "live" to make it joinable
   - **Toggle demo mode** — Enable demo mode under Settings to seed sample data
   - **Archive chats** — Save chat transcripts for completed sessions
4. During a live session, log in via the session login page with your facilitator credentials
5. Use the stage controls (Previous / Play-Pause / Next) to manage the session flow
6. Use the stage selector dropdown to jump to any stage directly

## License

Copyright © 2026 Rich Bodo. All rights reserved.

This software comes with **absolutely no warranty**. It is licensed under the **GNU General Public License (GPL)**. A copy of the license is included in this repository in the file [LICENSE.md](LICENSE.md).

See the [GNU GPL](https://www.gnu.org/licenses/gpl-3.0.html) for full terms and conditions.
