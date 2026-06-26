/**
 * Unit tests for the reconnect-event pairing logic used by the Admin
 * Connection Report. We don't render the React component here — the
 * pairing math is pure and the most error-prone bit.
 */

import { describe, it, expect } from 'vitest';
import { __test_summarize as summarize } from '@/components/ConnectionReport';

const log = (id: string, type: 'livekit_reconnecting' | 'livekit_reconnected', email: string, at: string) => ({
  id,
  event_type: type,
  event_data: { email, at },
  actor_email: email,
  created_at: at,
});

describe('ConnectionReport.summarize', () => {
  it('returns empty array for no logs', () => {
    expect(summarize([])).toEqual([]);
  });

  it('pairs reconnecting → reconnected and sums offline time', () => {
    const out = summarize([
      log('1', 'livekit_reconnecting', 'jack@x', '2026-06-26T10:00:00Z'),
      log('2', 'livekit_reconnected', 'jack@x', '2026-06-26T10:00:30Z'),
      log('3', 'livekit_reconnecting', 'jack@x', '2026-06-26T10:05:00Z'),
      log('4', 'livekit_reconnected', 'jack@x', '2026-06-26T10:05:15Z'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe('jack@x');
    expect(out[0].reconnectCount).toBe(2);
    expect(out[0].offlineMs).toBe(45_000);
  });

  it('counts unpaired trailing reconnecting events but adds no time', () => {
    const out = summarize([
      log('1', 'livekit_reconnecting', 'jill@x', '2026-06-26T10:00:00Z'),
    ]);
    expect(out[0].reconnectCount).toBe(1);
    expect(out[0].offlineMs).toBe(0);
  });

  it('sorts worst-first by offline time then reconnect count', () => {
    const out = summarize([
      log('1', 'livekit_reconnecting', 'a@x', '2026-06-26T10:00:00Z'),
      log('2', 'livekit_reconnected', 'a@x', '2026-06-26T10:00:05Z'),
      log('3', 'livekit_reconnecting', 'b@x', '2026-06-26T10:00:00Z'),
      log('4', 'livekit_reconnected', 'b@x', '2026-06-26T10:01:00Z'),
    ]);
    expect(out[0].email).toBe('b@x');
    expect(out[1].email).toBe('a@x');
  });

  it('groups by email independently across many participants', () => {
    const out = summarize([
      log('1', 'livekit_reconnecting', 'a@x', '2026-06-26T10:00:00Z'),
      log('2', 'livekit_reconnecting', 'b@x', '2026-06-26T10:00:01Z'),
      log('3', 'livekit_reconnected', 'a@x', '2026-06-26T10:00:10Z'),
      log('4', 'livekit_reconnected', 'b@x', '2026-06-26T10:00:20Z'),
    ]);
    expect(out).toHaveLength(2);
    const a = out.find((r) => r.email === 'a@x')!;
    const b = out.find((r) => r.email === 'b@x')!;
    expect(a.offlineMs).toBe(10_000);
    expect(b.offlineMs).toBe(19_000);
  });
});
