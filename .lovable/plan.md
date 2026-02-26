

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

