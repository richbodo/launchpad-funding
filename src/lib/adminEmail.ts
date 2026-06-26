/**
 * Resolve the facilitator email used to authorize Admin-page RPC calls
 * (e.g. `get_session_investments`, `get_session_chat_messages`).
 *
 * The Admin page has three login entry points, and only some of them
 * populate `useSessionUser()`:
 *
 *   1. `/login` flow      → `sessionUser.email` set, `adminEmail` state set
 *   2. Direct `/admin` login form → only the local `adminEmail` state set
 *   3. Demo-mode auto-login        → only the local `adminEmail` state set
 *   4. First-run bootstrap         → only the local `adminEmail` state set
 *
 * Historically the Admin page only forwarded `sessionUser?.email` to the
 * SECURITY DEFINER RPCs, so paths 2-4 silently produced an empty string
 * and the membership check rejected the call — making the
 * "Investments & Commitments" table appear permanently empty.
 *
 * This helper picks the first non-empty value and lower-cases it to
 * match the canonical storage format in `session_participants.email`.
 *
 * Returns an empty string when no email is available, which the RPC
 * still rejects safely — callers should treat that as "not authorized".
 */
export function resolveFacilitatorEmail(
  sessionUserEmail: string | null | undefined,
  adminEmail: string | null | undefined,
): string {
  const candidate = sessionUserEmail?.trim() || adminEmail?.trim() || '';
  return candidate.toLowerCase();
}
