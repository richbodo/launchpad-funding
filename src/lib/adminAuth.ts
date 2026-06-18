/**
 * Storage helpers for the short-lived admin (facilitator) bearer token issued
 * by the `participant-login` edge function. The token authorizes calls to the
 * admin-action / admin-settings / chat-archives-list edge functions.
 *
 * Storage strategy: sessionStorage (not localStorage) so the token disappears
 * when the tab is closed — facilitators have to re-authenticate per session.
 */

const ADMIN_TOKEN_KEY = "fundflow.admin_token";

export function setAdminToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function clearAdminToken(): void {
  setAdminToken(null);
}
