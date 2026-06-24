## Goal

Build a regression net that catches every login and landing-page failure mode we have hit before, then run it and fix anything broken. The recent password-hash refactor, RSS additions, and timezone widget all touched code paths that have historically regressed. We want failures to surface in CI, not from users.

## Coverage matrix

### Login entry points (`/login`)

For each entry point we assert: (a) the user lands where they should, (b) `useSession()` has the correct role + participant id, (c) UI affordances for that role render, (d) no extra password prompt appears when one shouldn't.

1. Manual login — investor (accredited)
2. Manual login — investor (community), including the investor-class picker
3. Manual login — startup
4. Manual login — facilitator with correct password
5. Manual login — facilitator with wrong password (stays on password step, error toast)
6. Manual login — facilitator with no credentials yet (create-password step appears, calls `participant-set-password`, then logs in)
7. Magic link — investor (`?session=&email=&role=investor`) auto-logs in, skips password
8. Magic link — investor without `investor_class` set, must pick class before entering session
9. Magic link — startup auto-logs in, lands in session (or `?edit=true` → green room)
10. Magic link — facilitator with `?password=` query (legacy demo path) auto-logs in
11. Magic link — facilitator without password param prompts for password
12. Demo "Jump in" auto-login button (uses `?autoLogin=true`)
13. Randomized demo login per role (Shuffle)
14. Logout clears session and `is_logged_in` flag

### Landing / home page (`/`)

15. Anonymous visitor sees upcoming events, RSS button, no signup count when total < 10
16. Signup count shows when ≥ 10
17. RSS button copies feed URL with `apikey` + `site` params
18. First-run / no-facilitator state surfaces bootstrap CTA
19. Demo mode banner renders when `app_settings.mode = 'demo'`

### Event landing (`/event/:slug`)

20. Public visitor sees title, description, **5-timezone strip** with correct flags
21. Three NZTech startup bullets render as `<ul><li>` (regression from earlier edit)
22. RSS button present beside title on desktop and stacked on mobile
23. Signup form posts to `event-signup` and shows success toast
24. Signed-in facilitator sees admin shortcut
25. Past/completed event hides signup, shows replay state

### Session page (`/session/:id`) per role

26. Facilitator: sees Stage Selector, play/pause, admin controls, can take stage
27. Startup: sees own video pane, presenter-only controls; cannot see admin
28. Investor (accredited): sees Invest dialog with $-amounts, Fund-ometer
29. Investor (community): sees gift pledge dialog capped at $100
30. Late joiner reads current stage state from Realtime Presence
31. Chat messages visible to all roles; anonymized labels correct
32. Magic-link arrival lands directly on session without a second prompt

### Edge-function smoke tests (Deno)

33. `participant-login` — success path, wrong password, unknown email, facilitator with shared credentials across sessions
34. `participant-set-password` — first-time set, refuses when credentials already exist for that email
35. `bootstrap-first-facilitator` — creates session + facilitator + credentials row
36. `facilitator_has_password` RPC returns true/false correctly
37. `events-rss` returns valid RSS XML for upcoming sessions only
38. `public-upcoming-events` returns the expected shape

## Technical approach

- Extend `src/pages/__tests__/Login.test.tsx` with cases 1–14. Mock `supabase.from`, `supabase.rpc('facilitator_has_password')`, `supabase.rpc('verify_participant_password')`, and `supabase.functions.invoke('participant-login' | 'participant-set-password')`. Assert `useSession` state via a probe component.
- Add `src/pages/__tests__/Index.test.tsx` cases 15–19. Mock the upcoming-events query, RSS button clipboard, and `app_settings`.
- Extend `EventLanding.test.tsx` with cases 20–25, including viewport-based rendering checks for the RSS button.
- Add `src/pages/__tests__/Session.test.tsx` role-scoped cases 26–32. Stub `LiveKitRoom` and Realtime channels; render with three different `SessionProvider` seeds.
- Add Deno tests under `supabase/functions/*/index_test.ts` for cases 33–38. Use `supabase--test_edge_functions` to run.
- Run the full suite with `npm run test` + the edge-function test tool. For every failure: locate the regression, fix it in product code (not by relaxing the test), re-run until green.
- Final pass: run `npm run build` and the security scan to confirm no critical findings before reporting back.

## Out of scope

- Visual regression / screenshot diffs.
- Performance / load testing of Realtime channels.
- Email-delivery integration tests (covered separately by the email-debugging guide).
