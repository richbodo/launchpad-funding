
## Demo Mode Design

### Problem
The login page only shows sessions that are currently "live" or starting within 15 minutes. During development, there are no such sessions, so the page shows "No active sessions right now" and testing is impossible without manually creating and activating sessions every time.

### Solution: Database-driven Demo Mode with a Seed Edge Function

**Concept:** A single `app_settings` table stores a `mode` value (`demo` or `production`). When in demo mode, a backend function seeds fixture data with sessions that are always "active" relative to the current time. The Admin page gets a new "Settings" tab where the facilitator can toggle between demo and production mode.

### Database Changes

**1. New `app_settings` table:**
```sql
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);
-- Seed default to 'demo'
INSERT INTO app_settings (key, value) VALUES ('mode', 'demo');
```

**2. RLS:** Readable by all, updatable by all (facilitators manage it via the admin UI).

### Edge Function: `seed-demo-data`

A backend function that, when invoked:
1. Reads `app_settings` to confirm mode is `demo`
2. Deletes any previous demo sessions (identified by name prefix `[DEMO]`)
3. Inserts 3 sessions with times anchored to `now()`:
   - **Session A** — "Demo Day Alpha": started 1 hour ago, ends in 2 hours, status `live`
   - **Session B** — "Demo Day Beta": starts in 10 minutes, ends in 3 hours, status `scheduled`
   - **Session C** — "Demo Day Gamma": completed yesterday, status `completed`
4. Populates each with fixture participants:
   - 2 facilitators (shared across all): `facilitator@demo.com` (password: `demo123`), `admin@demo.com` (password: `demo123`)
   - 3-4 startups per session with names, order, metadata (DD room link, website)
   - 4-5 investors per session with names
5. Returns a summary of what was created

### Admin Page Changes

**New "Settings" tab** in the Admin Tabs bar with:
- A labeled switch: **Demo Mode** (on/off)
- When toggled ON: calls the `seed-demo-data` edge function, sets `app_settings.mode = 'demo'`
- When toggled OFF: sets `app_settings.mode = 'production'`, optionally cleans up `[DEMO]` prefixed sessions
- Shows the current mode status with a badge

### Login Page Changes

**No changes needed.** The existing query already picks up `live` and soon-to-be-live `scheduled` sessions. Once demo data is seeded with correct timestamps, they appear automatically.

### Fixture Data Detail

```text
Session: [DEMO] Demo Day Alpha (LIVE, started 1hr ago)
├─ Facilitators: facilitator@demo.com, admin@demo.com
├─ Startups:
│   ├─ 1. AcmeTech (acme@demo.com) — website: acmetech.io, DD: drive.google.com/acme
│   ├─ 2. NovaPay (nova@demo.com) — website: novapay.com, DD: drive.google.com/nova
│   └─ 3. GreenGrid (green@demo.com) — website: greengrid.co, DD: drive.google.com/green
└─ Investors:
    ├─ alice@investor.com (Alice Chen)
    ├─ bob@investor.com (Bob Martinez)
    ├─ carol@investor.com (Carol Nguyen)
    └─ dave@investor.com (Dave Wilson)

Session: [DEMO] Demo Day Beta (SCHEDULED, starts in 10min)
├─ Same facilitators
├─ Different startups: CloudSync, DataForge, PixelAI
└─ Different investors: eve@investor.com, frank@investor.com, etc.

Session: [DEMO] Demo Day Gamma (COMPLETED, yesterday)
├─ Same facilitators
├─ Different startups + investors (for archive testing)
```

### Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/...` | Create `app_settings` table |
| `supabase/functions/seed-demo-data/index.ts` | New edge function for seeding fixtures |
| `src/pages/Admin.tsx` | Add "Settings" tab with demo mode toggle |
| `src/integrations/supabase/types.ts` | Auto-updated after migration |

### Reboot Resilience

The `app_settings` table persists across restarts. The `mode` value defaults to `demo`. The facilitator can invoke "Refresh Demo Data" from the Settings tab at any time to re-seed with fresh timestamps (so sessions are always current). When ready for production, flip to `production` mode and demo data gets cleaned up.

---

## Email Feature: Session Welcome Emails

### Overview

When an admin adds a participant to a session, they can optionally send a branded welcome email. The email includes a role-specific welcome message (configurable by the admin), a magic login link, and an add-to-calendar link.

### Phase 1: Email Settings in Admin

**Goal:** Allow the facilitator to configure email parameters that are stored in `app_settings` and used when composing welcome emails.

#### New Settings in Admin → Settings tab

Under the existing Demo Mode section, add an **"Email Settings"** section with:

1. **Facilitator Contact Email** — a single text input for the contact/reply-to email shown in outbound emails.
   - Default: `noreply@pitch.globaldonut.com` (unroutable placeholder)
   - Stored in `app_settings` as key `email_contact`

2. **Welcome Messages** — three plain-text edit boxes, one per role:
   - **Facilitator Welcome Message** — plain text prepended to welcome emails sent to facilitators
   - **Startup Welcome Message** — plain text prepended to welcome emails sent to startups
   - **Investor Welcome Message** — plain text prepended to welcome emails sent to investors
   - Each has a default boilerplate message and an edit icon to toggle editing
   - Stored in `app_settings` as keys: `email_welcome_facilitator`, `email_welcome_startup`, `email_welcome_investor`

#### Default Welcome Messages

- **Facilitator:** "Welcome! You have been added as a facilitator for this session. As a facilitator, you have full access to session management, participant setup, and live session controls."
- **Startup:** "Welcome! You have been invited to present at this session. Please review the session details below and prepare your pitch. Use the login link to access the session when it goes live."
- **Investor:** "Welcome! You have been invited to participate as an investor in this session. Review the session details below and use the login link to join when the session goes live."

#### UI Behavior

- Each welcome message box is read-only by default, showing the current text
- A small pencil/edit icon next to each label toggles the box into edit mode
- Changes are saved when the user clicks a "Save" button or leaves the field
- All values are persisted to `app_settings` via upsert

### Phase 2: Send Email on Participant Add

**Goal:** When an admin adds a participant, show a confirmation dialog asking whether to send a welcome email.

#### Flow

1. Admin fills in participant details and clicks the add (+) button
2. Participant is inserted into `session_participants`
3. A confirmation dialog appears: "Send welcome email to [email]?" with Yes/No buttons
4. If Yes:
   - Compose the email using the role-specific welcome message from `app_settings`
   - Include session details: name, date/time, timezone
   - Include a **magic login link** — a URL that pre-fills the session and email on the login page (e.g., `https://pitch.globaldonut.com/login?session={id}&email={email}&role={role}`)
   - Include an **add-to-calendar link** — a Google Calendar link with the session name, start/end time, and description
   - Include the facilitator contact email from settings
   - Call the `send-transactional-email` edge function with the appropriate template
5. If No: skip email, participant is already added

#### Email Template: `session-welcome`

A single React Email template that accepts props:
- `recipientName` — display name or email
- `role` — facilitator | startup | investor
- `welcomeMessage` — the role-specific plain text welcome message
- `sessionName` — the session name
- `sessionDate` — formatted date/time string
- `sessionTimezone` — timezone
- `loginUrl` — the magic login link
- `calendarUrl` — the Google Calendar add link
- `contactEmail` — the facilitator contact email

The template renders:
1. A heading: "You're Invited: [Session Name]"
2. The plain-text welcome message (role-specific)
3. Session details (date, time, timezone)
4. A "Join Session" button linking to the magic login URL
5. An "Add to Calendar" link
6. Footer with contact email

### Phase 3: Email Logs Page

**Goal:** A basic read-only page in the admin section that shows email send history for debugging.

#### Implementation

- New tab in Admin: **"Email Logs"** (with a Mail icon)
- Shows a simple table of entries from `email_send_log`, deduplicated by `message_id`
- Columns: Template, Recipient, Status (color-coded badge), Timestamp, Error (if any)
- Sorted by timestamp descending
- Basic time filter: Last 24h / 7 days / 30 days
- Read-only — no actions, just for debugging
- Query uses the service role indirectly via an edge function (since `email_send_log` has service-role-only RLS)

### Implementation Order

1. **Email Settings UI** — Add the email settings section to Admin → Settings
   - Store defaults in `app_settings`
   - Build the UI with edit toggles
   
2. **Email Infrastructure** — Scaffold transactional email sending
   - Set up the `send-transactional-email` edge function
   - Create the `session-welcome` email template
   - Deploy edge functions

3. **Send-on-Add Dialog** — Wire up the confirmation dialog in the participant add flow
   - After successful insert, show dialog
   - On confirm, invoke the email function with composed data
   - Generate magic login URL and calendar URL

4. **Email Logs** — Add the email logs tab
   - Create a simple edge function to read `email_send_log` (since RLS is service-role only)
   - Build a basic table view in a new Admin tab

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/pages/Admin.tsx` | Add Email Settings section, send-email dialog, Email Logs tab |
| `supabase/functions/_shared/transactional-email-templates/session-welcome.tsx` | New email template |
| `supabase/functions/_shared/transactional-email-templates/registry.ts` | Register the template |
| `supabase/functions/send-transactional-email/index.ts` | Scaffolded by tooling |
| `supabase/functions/email-logs/index.ts` | New edge function to query email_send_log |

### Database Changes

No schema changes needed — email settings are stored in the existing `app_settings` table using new keys. Email infrastructure tables (`email_send_log`, etc.) already exist.

### Magic Login Link Format

```
https://pitch.globaldonut.com/login?session={session_id}&email={email}&role={role}
```

The login page will need a small update to read these query params and auto-fill the session selection and email field.

### Google Calendar Link Format

```
https://calendar.google.com/calendar/event?action=TEMPLATE
  &text={Session Name}
  &dates={start_ISO}/{end_ISO}
  &details={Description with login link}
  &location=Online
```
