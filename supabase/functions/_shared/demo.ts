/**
 * Shared constants for the demo-mode flow.
 *
 * `DEMO_FACILITATOR_PASSWORD` is the well-known plaintext password seeded
 * onto every demo facilitator row by `seed-demo-data`. It's intentionally
 * public — the /demo-logins page displays it so the auto-login UI can
 * perform a real `participant-login` handshake (no demo-mode auth bypass).
 */
export const DEMO_FACILITATOR_PASSWORD = "demo123";
