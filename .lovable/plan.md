

## What's happening

The `is_logged_in` flag on `session_participants` is set to `true` in the database from your previous login attempt. Since there's no logout or session-clearing logic, the flag stays `true` permanently — so every subsequent login attempt gets blocked.

This is **not** a cookie issue. It's a database state issue: the `is_logged_in` column for `admin@fundflow.com` is stuck at `true`.

## Recommendation

We should handle this in application logic rather than asking you to manually clear anything. Here's the plan:

### 1. Add a logout flow that resets `is_logged_in`
- When a user navigates away or explicitly logs out (via the `logout()` function in `sessionContext`), update `session_participants.is_logged_in = false` in the database.
- Hook this into `window.onbeforeunload` as a best-effort cleanup for tab/browser closes.

### 2. Replace the hard block with a "resume session" option
- Instead of showing an error when `is_logged_in` is `true`, offer the user a choice: **"You're already logged in. Resume your session?"**
- If they confirm, proceed with login normally (re-set the context and navigate to the session).
- This handles the common case of page refreshes, accidental closes, or stale state gracefully.

### 3. Add a facilitator "kick / reset" ability (optional, later)
- On the Admin page, allow facilitators to reset the `is_logged_in` flag for any participant — useful if someone gets stuck.

### Technical details

**Files to modify:**
- **`src/lib/sessionContext.tsx`** — Update `logout()` to call `supabase.from('session_participants').update({ is_logged_in: false })` before clearing local state. Add a `useEffect` cleanup with `beforeunload`.
- **`src/pages/Login.tsx`** — Replace the `is_logged_in` error toast (lines 81-85) with a confirmation dialog or auto-resume logic.
- **`src/pages/Session.tsx`** — Ensure navigating away or unmounting triggers the logout/cleanup.

**No database migration needed** — the `is_logged_in` and `logged_in_at` columns already exist.

**Immediate fix included** — as part of this change, the stale `is_logged_in = true` record for `admin@fundflow.com` will be reset so you can test right away.

