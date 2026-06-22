# Investigation: where the unknown sessions came from

The `[SIM]` and `[SMOKE]` sessions in production are **not** outside attackers — they were created by our own test harnesses:

- `[SIM] …` rows come from `tests/simulation/harness.ts` (the full-session simulation we built over the last two days). It seeds rows directly via `psql`.
- `[SMOKE] …` rows come from `scripts/smoke-edge-functions-seeded.sh`, which seeds via the Supabase REST API using the service-role key.

Both of these were run against the **production database** at some point — either manually with prod `PG*`/service-role env vars, or by a CI job that has those secrets. They never go through the Admin UI, so no login was required.

# But there is a real, separate vulnerability

While investigating I found a more serious gap: the RLS on `public.sessions`, `public.session_participants`, and `public.app_settings` is wide open:

```
sessions               INSERT/UPDATE/DELETE  → anon, authenticated   (no check)
session_participants   INSERT/UPDATE/DELETE  → anon, authenticated   (no check)
app_settings           INSERT/UPDATE          → anon, authenticated  (no check)
```

The publishable anon key ships in the JS bundle, so **anyone in the world** can hit the Supabase REST API and:

- create / update / delete sessions
- add / promote / delete participants (including facilitators)
- flip `mode=demo`, which then bypasses the admin-token check in `authorizeFacilitator`

The Admin UI itself already routes every mutation through the `admin-action` / `admin-settings` edge functions (which require an admin token issued by `participant-login`). So locking down the tables won't break the legitimate flow — it will only block the back door.

# Plan

## 1. Migration: tighten RLS to service-role-only writes

Replace the permissive write policies on `sessions`, `session_participants`, `app_settings` with policies that allow `INSERT/UPDATE/DELETE` only to `service_role`. Keep `SELECT` public (the landing page, login picker, and session screen all rely on anonymous reads).

## 2. Move the two remaining client-side writes to edge functions

After the migration, two legitimate client writes would break — fix them first:

- **`Session.tsx` logout** (`is_logged_in: false`) → switch to the existing `participant-presence` edge function (already does exactly this with the service role).
- **`StartupEditDialog` self-edit** (funding goal / DD room / website) → add a small `startup-update-self` edge function that only allows updates to those three columns for a `role='startup'` row, keyed by `participant_id`. Same trust model as `participant-presence`.

## 3. Stop running test scripts against production

Add a guard to `tests/simulation/harness.ts` and `scripts/smoke-edge-functions-seeded.sh` that refuses to run if `VITE_SUPABASE_URL` / `SUPABASE_URL` points at the production project ref (`bjtnmtdmgjkdnztgbaau`). This prevents accidental seeding into prod even with valid credentials.

## 4. Clean up the existing junk rows

After the lockdown lands, delete the `[SIM] %` and `[SMOKE] %` rows from production via the admin-action `delete_session` path (which now requires a real facilitator login).

## Out of scope (call out, don't change)

- The `authorizeFacilitator` demo-mode bypass remains. With #1 in place, anon can no longer flip `mode=demo`, so the bypass is only reachable when a real facilitator has explicitly enabled demo mode.
- We do not change the custom (non-Supabase-Auth) login model — facilitator password verification via `participant-login` stays as the single source of truth for issuing admin tokens.
