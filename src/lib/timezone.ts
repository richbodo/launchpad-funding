/**
 * Timezone helpers for scheduling.
 *
 * A session is scheduled as a *wall-clock* time in a specific IANA time zone
 * (e.g. "9:00 AM in America/New_York"). We must store that as an absolute UTC
 * instant, and later render it back in the session's zone for display/emails.
 * These helpers use the built-in `Intl` APIs (full IANA + DST data in modern
 * browsers and Deno/Node), so no extra dependency is required.
 */

/**
 * Offset of `timeZone` at the given UTC instant, in minutes, defined so that:
 *   wallClock = utcInstant + offset
 * e.g. America/New_York in summer (EDT, UTC-4) returns -240.
 */
function tzOffsetMinutes(timeZone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(utcDate)) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  // Some engines format midnight as hour "24"; normalize to 0.
  const hour = map.hour % 24;
  const asIfUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return (asIfUTC - utcDate.getTime()) / 60000;
}

/**
 * Interpret a wall-clock `date` + `time` as being in `timeZone`, and return the
 * corresponding UTC instant as an ISO string.
 *
 * @param date  Calendar date as "YYYY-MM-DD" (e.g. from <input type="date">).
 * @param time  Wall-clock time as "HH:mm" (24-hour).
 * @param timeZone  IANA zone id, e.g. "America/New_York".
 *
 * @example
 *   zonedWallTimeToUtcISO('2026-06-18', '09:00', 'America/New_York')
 *   // => '2026-06-18T13:00:00.000Z'  (09:00 EDT == 13:00 UTC)
 */
export function zonedWallTimeToUtcISO(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) {
    throw new RangeError(`Invalid date/time/zone: "${date}" "${time}" "${timeZone}"`);
  }
  // Treat the wall time as if it were already UTC, then correct by the zone's
  // offset at that instant. Accurate except for wall times that fall inside a
  // DST transition gap/overlap (sessions are not normally scheduled there).
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = tzOffsetMinutes(timeZone, new Date(utcGuess));
  return new Date(utcGuess - offset * 60000).toISOString();
}

/**
 * Format a UTC timestamp as a calendar date in `timeZone`,
 * e.g. "Thursday, June 18, 2026".
 */
export function formatDateInTimeZone(utc: string | Date, timeZone: string): string {
  return new Date(utc).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format a UTC timestamp as a time-of-day in `timeZone`, e.g. "9:00 AM".
 * When `withZoneName` is true, appends the zone abbreviation, e.g. "9:00 AM EDT".
 */
export function formatTimeInTimeZone(
  utc: string | Date,
  timeZone: string,
  withZoneName = false,
): string {
  return new Date(utc).toLocaleTimeString('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    ...(withZoneName ? { timeZoneName: 'short' } : {}),
  });
}
