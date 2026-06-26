/**
 * Tests for the NUDGES list ordering & template generation. The ordering
 * encodes facilitator guidance (AC power first, then VPN, then refresh,
 * then rejoin, then lower load) and is part of the product contract —
 * regressions would change what facilitators see in the dropdown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NUDGES, sendNudge } from '@/lib/connectionNudges';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error: null })),
    })),
  },
}));

describe('connectionNudges', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orders nudges: AC power, VPN, refresh tile, rejoin, lower load', () => {
    expect(NUDGES.map((n) => n.id)).toEqual([
      'ac_power',
      'disable_vpn',
      'refresh_tile',
      'rejoin',
      'lower_load',
    ]);
  });

  it('refresh_tile has no chat template (local-only action)', () => {
    expect(NUDGES.find((n) => n.id === 'refresh_tile')?.template).toBeUndefined();
  });

  it('every chat-emitting nudge includes the target name in the body', () => {
    for (const n of NUDGES) {
      if (!n.template) continue;
      expect(n.template('Jack')).toContain('Jack');
    }
  });

  it('sendNudge returns ok for a templated nudge', async () => {
    const res = await sendNudge({
      sessionId: 's1',
      facilitatorEmail: 'f@x',
      facilitatorName: 'Fac',
      targetName: 'Jack',
      nudgeId: 'ac_power',
    });
    expect(res.ok).toBe(true);
  });

  it('sendNudge refuses to send for refresh_tile (no template)', async () => {
    const res = await sendNudge({
      sessionId: 's1',
      facilitatorEmail: 'f@x',
      facilitatorName: 'Fac',
      targetName: 'Jack',
      nudgeId: 'refresh_tile',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no_template');
  });
});
