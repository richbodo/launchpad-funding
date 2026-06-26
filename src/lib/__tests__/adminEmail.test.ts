import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveFacilitatorEmail } from '@/lib/adminEmail';

/**
 * Regression coverage for the "Admin Investments & Commitments table is empty"
 * bug. The bug happened because the page forwarded `sessionUser?.email` to the
 * `get_session_investments` SECURITY DEFINER RPC, but three of the four admin
 * entry paths never populate `sessionUser` — they only set the local
 * `adminEmail` state. The RPC then received an empty string, failed the
 * "is this caller a participant?" check, and returned no rows.
 *
 * These tests pin the contract: regardless of which entry path authenticated
 * the facilitator, the email forwarded to the RPC must be the lower-cased
 * facilitator address. If a future refactor regresses any of these paths the
 * table will go empty again — and these tests will fail before that ships.
 */
describe('resolveFacilitatorEmail — covers all Admin login entry paths', () => {
  it('uses sessionUser.email when /login flow populated it', () => {
    expect(resolveFacilitatorEmail('Alice@Example.com', '')).toBe('alice@example.com');
  });

  it('falls back to adminEmail for the direct /admin password login path', () => {
    expect(resolveFacilitatorEmail(undefined, 'Facilitator@Demo.com')).toBe(
      'facilitator@demo.com',
    );
  });

  it('falls back to adminEmail for demo-mode auto-login', () => {
    expect(resolveFacilitatorEmail(null, 'facilitator@demo.com')).toBe(
      'facilitator@demo.com',
    );
  });

  it('falls back to adminEmail for the first-run bootstrap flow', () => {
    expect(resolveFacilitatorEmail(undefined, 'owner@newremix.app')).toBe(
      'owner@newremix.app',
    );
  });

  it('prefers sessionUser when both are set (consistent canonical source)', () => {
    expect(resolveFacilitatorEmail('a@x.com', 'b@x.com')).toBe('a@x.com');
  });

  it('returns empty string when neither is set (safe default — RPC rejects)', () => {
    expect(resolveFacilitatorEmail(undefined, undefined)).toBe('');
    expect(resolveFacilitatorEmail('', '')).toBe('');
  });

  it('trims accidental whitespace before lower-casing', () => {
    expect(resolveFacilitatorEmail('  ', '  Boss@Co.com  ')).toBe('boss@co.com');
  });
});

/**
 * End-to-end-ish behavioral test: simulate the exact call shape the Admin
 * page makes for each authenticated state, and verify the RPC receives a
 * non-empty `_email` argument. This is the concrete repro of the bug — the
 * `_email: ''` invocation is what silently returned zero rows.
 */
describe('Admin → get_session_investments RPC argument shape', () => {
  const sessionId = '00000000-0000-0000-0000-000000000001';
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'inv-1', amount: 25000, investor_email: 'i@x.com' }],
      error: null,
    });
  });

  async function fetchInvestments(sessionUserEmail: string | null, adminEmail: string) {
    return rpc('get_session_investments', {
      _session_id: sessionId,
      _email: resolveFacilitatorEmail(sessionUserEmail, adminEmail),
    });
  }

  it('path 1 (/login flow) → RPC gets sessionUser.email and returns rows', async () => {
    const result = await fetchInvestments('admin@demo.com', 'admin@demo.com');
    expect(rpc).toHaveBeenCalledWith('get_session_investments', {
      _session_id: sessionId,
      _email: 'admin@demo.com',
    });
    expect(result.data).toHaveLength(1);
  });

  it('path 2 (direct /admin password login) → RPC gets adminEmail and returns rows', async () => {
    const result = await fetchInvestments(null, 'admin@demo.com');
    expect(rpc).toHaveBeenCalledWith('get_session_investments', {
      _session_id: sessionId,
      _email: 'admin@demo.com',
    });
    expect(result.data).toHaveLength(1);
  });

  it('path 3 (demo-mode auto-login) → RPC gets adminEmail and returns rows', async () => {
    const result = await fetchInvestments(null, 'facilitator@demo.com');
    expect(rpc).toHaveBeenCalledWith(
      'get_session_investments',
      expect.objectContaining({ _email: 'facilitator@demo.com' }),
    );
    expect(result.data).toHaveLength(1);
  });

  it('path 4 (first-run bootstrap) → RPC gets adminEmail and returns rows', async () => {
    const result = await fetchInvestments(null, 'owner@newremix.app');
    expect(rpc).toHaveBeenCalledWith(
      'get_session_investments',
      expect.objectContaining({ _email: 'owner@newremix.app' }),
    );
    expect(result.data).toHaveLength(1);
  });

  it('regression guard: _email must never be empty when an adminEmail exists', async () => {
    await fetchInvestments(null, 'admin@demo.com');
    const args = rpc.mock.calls[0][1];
    expect(args._email).not.toBe('');
    expect(args._email).toMatch(/@/);
  });
});
