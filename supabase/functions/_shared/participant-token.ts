/**
 * Shared helpers for verifying the per-participant session token minted by
 * `mint_participant_token_by_password` / `mint_participant_token_by_email`.
 *
 * Edge functions that previously trusted a client-supplied `participant_id`
 * (self-update, presence, notify, upload-self, LiveKit token, etc.) now
 * require this token instead and derive the participant identity server-side.
 */

export interface ResolvedParticipant {
  participant_id: string;
  session_id: string;
  email: string;
  role: 'facilitator' | 'startup' | 'investor';
}

/**
 * Resolve a participant session token to the underlying participant row.
 * Returns null when the token is missing, malformed, expired, or unknown.
 *
 * Accepts either a `resolve_participant_token` RPC exposure or falls back to
 * a direct read from `participant_sessions` (using the caller-supplied
 * service-role client).
 */
export async function resolveParticipantToken(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  token: unknown,
): Promise<ResolvedParticipant | null> {
  if (!token || typeof token !== 'string' || token.length < 16 || token.length > 128) {
    return null;
  }
  const { data, error } = await supabase
    .from('participant_sessions')
    .select('participant_id, session_id, email, role, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return {
    participant_id: data.participant_id,
    session_id: data.session_id,
    email: data.email,
    role: data.role,
  };
}

/**
 * Best-effort check that the incoming request was authenticated with the
 * project's service-role JWT (used by internal edge-function-to-edge-function
 * calls). The gateway has already verified the signature when `verify_jwt`
 * is true, so we only need to inspect the `role` claim.
 */
export function isServiceRoleRequest(req: Request): boolean {
  const auth = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const raw = auth.replace(/^Bearer\s+/i, '').trim();
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 3) return false;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}
