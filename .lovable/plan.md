
## Goal

When a non-logged-in visitor lands on `pitch.globaldonut.com/`, show a list of upcoming public events (each linking to its `/event/:slug` landing page) instead of immediately bouncing to `/login`. Magic-link, `/login?...`, `/event/:slug`, `/session/:id`, `/admin`, and all other entry points are untouched.

## Scope

- Only the root route (`/`) behavior changes.
- No DB schema changes. No auth changes.
- Logged-in users (anyone with an active `SessionProvider` user) keep the current behavior — straight to login/session resume.

## Changes

### 1. New edge function: `public-upcoming-events`

`supabase/functions/public-upcoming-events/index.ts` — public GET, no JWT.

- Service-role read of `sessions` where:
  - `slug IS NOT NULL` (only events that have a public landing page)
  - `status IN ('scheduled','live')`
  - `end_time >= now()` (hide finished sessions)
- Order by `start_time ASC`, limit ~20.
- Returns only safe public fields: `id, name, slug, description, start_time, end_time, timezone, status, hero_image_url`.
- Standard CORS headers, mirrors the pattern in `event-landing/index.ts`.

### 2. Replace `src/pages/Index.tsx`

Currently it just `navigate('/login')`. New behavior:

- Read `useSessionUser()`. If `user` is set → `navigate('/login')` (preserves the current "resume into session" flow used by magic-link returnees who already have state, and is a safe no-op for fresh tabs).
- Otherwise fetch `public-upcoming-events` and render:
  - Page header with event branding (reuse the dark fintech aesthetic + glassmorphism already used on `EventLanding.tsx`).
  - "Upcoming events" heading.
  - A card grid: each card shows hero image (or placeholder), name, formatted local date/time (use `src/lib/timezone.ts`), short description, and a primary button `View event →` linking to `/event/${slug}`.
  - Empty state ("No upcoming events right now") when the list is empty, with a secondary link to `/login` for participants who already have an invitation.
  - Loading skeleton while fetching.
- Always render a small "Already invited? Sign in" link to `/login` so existing participants can still get in directly.

### 3. Routing

No router changes needed — `/` already maps to `Index`. Magic links go to `/login?...` or `/event/:slug` and are unaffected. `/session/:id`, `/admin`, `/event/:slug`, `/unsubscribe` are unaffected.

### 4. Tests

- `src/pages/__tests__/Index.test.tsx` (new): mocks `fetch` for `public-upcoming-events` and asserts:
  - Renders event cards with name + link to `/event/<slug>`.
  - Renders empty state when API returns `[]`.
  - Redirects to `/login` when `SessionProvider` already has a user.

## Technical notes

- "First time" is interpreted as "anonymous visitor with no in-memory session user." We don't set a cookie — every fresh tab gets the events page, which matches the request ("hits the home page for the first time"). This avoids touching storage and keeps magic-link / `/event/:slug` / `/login` flows fully unchanged.
- The events list intentionally uses a new edge function rather than the existing `event-landing` (which is slug-scoped) so we don't widen its contract.
- No changes to `Login.tsx`, `EventLanding.tsx`, `event-landing`, or `event-signup`.

## Out of scope

- Persisting "have I seen this before?" via cookies/localStorage.
- Filtering events by tenant/domain (single-tenant app today).
- Showing past events or an archive.
