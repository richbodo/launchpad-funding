/**
 * Templated facilitator nudges for participants whose connection is degrading.
 *
 * Each nudge is a *suggestion* posted as a normal chat message — no silent
 * auto-recovery. The order below mirrors the real-world troubleshooting
 * sequence for an unstable client connection:
 *
 *   1. AC power      — laptops on battery aggressively throttle Wi-Fi & CPU
 *   2. Disable VPN   — double-NAT is a common cause of UDP rebinds
 *   3. Refresh tile  — local re-subscribe; cheap, no message sent
 *   4. Rejoin call   — full LiveKit reconnect, last resort before the user
 *                       changes their environment
 *   5. Lower load    — close tabs / pause downloads
 *
 * Posting to chat keeps the human in the loop (the participant sees it,
 * decides whether to act) and creates an audit trail of which nudges were
 * fired during which session.
 */

import { supabase } from '@/integrations/supabase/client';

export type NudgeId = 'ac_power' | 'disable_vpn' | 'refresh_tile' | 'rejoin' | 'lower_load';

export interface NudgeDef {
  id: NudgeId;
  label: string;
  /** Optional chat template. `refresh_tile` is local-only and has none. */
  template?: (name: string) => string;
}

export const NUDGES: NudgeDef[] = [
  {
    id: 'ac_power',
    label: 'Plug in AC power',
    template: (name) =>
      `Hey ${name} — quick check: if you're on a laptop, plug into AC power. Battery mode aggressively throttles Wi-Fi & CPU and is a common cause of video dropouts.`,
  },
  {
    id: 'disable_vpn',
    label: 'Disable VPN',
    template: (name) =>
      `Hey ${name} — try disabling any VPN or corporate proxy. Double-NAT is a common cause of dropped connections.`,
  },
  {
    id: 'refresh_tile',
    label: 'Refresh their video tile',
    // Local-only — runs softRetry on the VideoPane, no chat message.
  },
  {
    id: 'rejoin',
    label: 'Ask them to rejoin',
    template: (name) =>
      `Hey ${name} — could you click Leave Call and then Join Call again? That'll re-establish your video connection.`,
  },
  {
    id: 'lower_load',
    label: 'Suggest closing other apps',
    template: (name) =>
      `Hey ${name} — your network looks like it's struggling. Try closing other tabs, pausing downloads, or stepping closer to your Wi-Fi router.`,
  },
];

/**
 * Send a nudge as a chat message from the facilitator. Posts into the
 * existing chat_messages table so the broadcast trigger fans it out to the
 * whole room — the targeted participant sees it just like any other chat,
 * no special UI required on their end.
 */
export async function sendNudge(params: {
  sessionId: string;
  facilitatorEmail: string;
  facilitatorName: string | null;
  targetName: string;
  nudgeId: NudgeId;
}): Promise<{ ok: boolean; error?: string }> {
  const def = NUDGES.find((n) => n.id === params.nudgeId);
  if (!def?.template) return { ok: false, error: 'no_template' };
  const { error } = await supabase.from('chat_messages').insert({
    session_id: params.sessionId,
    sender_email: params.facilitatorEmail,
    sender_name: params.facilitatorName ?? 'Facilitator',
    sender_role: 'facilitator',
    message: def.template(params.targetName),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
