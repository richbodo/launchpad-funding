# Green Room — Pre-session profile & readiness page

A new role-aware landing page where startups and facilitators complete their profile (logo/photo, bio/description, links, funding goal) before — and during — a session. Investors skip it.

## Routing

- New route: `/session/:id/ready` → `<GreenRoom />`
- **Login redirect logic** (`Login.tsx` post-auth):
  - role = `investor` → `/session/:id` (unchanged)
  - role = `startup` or `facilitator` → `/session/:id/ready`
- **Session page guard**: if a startup/facilitator hits `/session/:id` and the session status is `draft` or `scheduled`, redirect to `/ready`. Once `live`, no forced redirect — Green Room becomes opt-in via sidebar link.
- **Green Room → Session**: "Enter session" button (always present) navigates to `/session/:id`. For facilitators, a separate "Go Live" button flips status `scheduled → live` (no blocking on startup readiness — just a confirmation if any startup is incomplete).

## Green Room UI (`src/pages/GreenRoom.tsx`)

Single-column page, dark fintech aesthetic to match the rest of the app. Header shows session name, scheduled time, status pill, and an "Enter session" CTA.

**Startup view:**
- Readiness checklist card at top: Logo ✓ / Description ✓ / Funding goal ✓ / DD room link ○ / Website ○ (DD + website are optional, shown as informational).
- Inline profile form (extracted from `StartupEditDialog` body into a reusable `<StartupProfileForm>`): `ImageUploadField` for logo, description textarea, funding goal, DD room link, website link. Auto-saves on blur or via explicit Save button (keep current Save-button UX for now).

**Facilitator view:**
- Readiness checklist: Photo ✓ / Bio ✓.
- Inline `<FacilitatorProfileForm>`: `ImageUploadField` (new — facilitator photo), bio textarea (≤500 chars).
- Roster card listing every startup with their readiness state (logo/description/goal checks) — view-only, helps facilitators nudge stragglers.
- "Go Live" button (only when status = `scheduled`). If any startup is incomplete, show a confirm dialog ("3 startups haven't finished their profile. Go live anyway?").

**Sidebar link**: Add a "Green Room" / "Edit profile" link in the existing Session top bar (next to existing role-scoped actions) so users can return to edit while live.

## Backend changes

- **`facilitator-update-self` edge function**: add `image_url` field (mirror what `startup-update-self` already does — lenient URL handling, ≤1000 chars). One small edit, no migration needed (`session_participants.image_url` column already exists and is used for startups).
- **`upload-event-image` edge function**: extend the participant self-upload branch to also accept `role = 'facilitator'` (currently only `'startup'`). Two-line change.
- No schema migrations required.

## Component extraction

Refactor without behavior change:
- Extract `StartupEditDialog`'s form body → `src/components/StartupProfileForm.tsx`. Dialog wraps it; Green Room embeds it directly.
- Extract `FacilitatorEditDialog`'s form body → `src/components/FacilitatorProfileForm.tsx` and add the new `ImageUploadField`.
- Existing tests (`StartupEditDialog.test.tsx`) keep passing since dialog still mounts the same form.

## Slice of C — invitation deep link

- `session-invitation` email template (startup + facilitator variants): add a "Set up your profile" button linking to `https://<domain>/session/:id/ready?email=…`.
- Login page: if `?email=` and `?session=` are present in URL, prefill the email field and pre-select the session. (No new tokenized auth — user still types their password / requests magic link; this is just a convenience deep link. Anything heavier can come later.)

## Files touched

**New:**
- `src/pages/GreenRoom.tsx`
- `src/components/StartupProfileForm.tsx`
- `src/components/FacilitatorProfileForm.tsx`
- `src/components/ReadinessChecklist.tsx`

**Edited:**
- `src/App.tsx` — register `/session/:id/ready` route
- `src/pages/Login.tsx` — post-auth redirect by role + status; honor `?email` / `?session` query
- `src/pages/Session.tsx` — extract form bodies, add Green Room sidebar link, draft/scheduled redirect for startups/facilitators
- `supabase/functions/facilitator-update-self/index.ts` — accept `image_url`
- `supabase/functions/upload-event-image/index.ts` — allow facilitator self-upload
- `supabase/functions/_shared/transactional-email-templates/session-invitation.tsx` — "Set up your profile" CTA

## Out of scope (this pass)

- Tokenized profile-edit magic link (could be added later if the plain email-prefill deep link proves friction-y)
- Investor profiles
- Blocking "Go Live" on incomplete startups
- Auto-save / draft persistence (keep explicit Save button)

## Testing

- Unit: a new `GreenRoom.test.tsx` covering checklist computation and the Go Live confirm dialog
- Existing `StartupEditDialog.test.tsx` continues to pass after the extraction
- Manual: log in as startup → land on Green Room → upload logo → enter session → see logo render
