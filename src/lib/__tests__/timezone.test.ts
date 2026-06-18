import { describe, it, expect } from 'vitest';
import {
  zonedWallTimeToUtcISO,
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from '../timezone';

describe('zonedWallTimeToUtcISO', () => {
  it('converts a summer (EDT, UTC-4) wall time to UTC', () => {
    expect(zonedWallTimeToUtcISO('2026-06-18', '09:00', 'America/New_York')).toBe(
      '2026-06-18T13:00:00.000Z',
    );
  });

  it('converts a winter (EST, UTC-5) wall time to UTC', () => {
    expect(zonedWallTimeToUtcISO('2026-01-15', '09:00', 'America/New_York')).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('is a no-op for UTC', () => {
    expect(zonedWallTimeToUtcISO('2026-06-18', '09:00', 'UTC')).toBe(
      '2026-06-18T09:00:00.000Z',
    );
  });

  it('handles a half-hour offset zone (IST, UTC+5:30)', () => {
    expect(zonedWallTimeToUtcISO('2026-06-18', '09:00', 'Asia/Kolkata')).toBe(
      '2026-06-18T03:30:00.000Z',
    );
  });

  it('handles a zone ahead of UTC that crosses the date line backward', () => {
    // 01:00 in Tokyo (UTC+9) is 16:00 the previous day in UTC.
    expect(zonedWallTimeToUtcISO('2026-06-18', '01:00', 'Asia/Tokyo')).toBe(
      '2026-06-17T16:00:00.000Z',
    );
  });

  it('throws on malformed input', () => {
    expect(() => zonedWallTimeToUtcISO('not-a-date', '09:00', 'UTC')).toThrow();
  });
});

describe('formatTimeInTimeZone', () => {
  it('renders a UTC instant as local time in the target zone', () => {
    // 13:00 UTC is 09:00 in New York (EDT).
    expect(formatTimeInTimeZone('2026-06-18T13:00:00.000Z', 'America/New_York')).toBe(
      '9:00 AM',
    );
  });

  it('appends the zone abbreviation when requested', () => {
    expect(
      formatTimeInTimeZone('2026-06-18T15:00:00.000Z', 'America/New_York', true),
    ).toBe('11:00 AM EDT');
  });

  it('renders the same instant differently in another zone', () => {
    expect(formatTimeInTimeZone('2026-06-18T13:00:00.000Z', 'America/Los_Angeles')).toBe(
      '6:00 AM',
    );
  });
});

describe('formatDateInTimeZone', () => {
  it('uses the target zone to decide the calendar date', () => {
    // 02:00 UTC on the 18th is still the 17th in Los Angeles (UTC-7 in summer).
    expect(formatDateInTimeZone('2026-06-18T02:00:00.000Z', 'America/Los_Angeles')).toBe(
      'Wednesday, June 17, 2026',
    );
  });
});
