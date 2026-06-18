import { toast } from 'sonner';

/**
 * Normalized shape pulled out of a Supabase / PostgREST error (or any thrown
 * value). Supabase errors carry `message`, plus optional Postgres `code`,
 * `details`, and `hint` fields that are extremely useful for debugging but are
 * usually thrown away by generic "something went wrong" handlers.
 */
export interface NormalizedError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

/** Extract the useful fields from a Supabase error, Error, or arbitrary value. */
export function normalizeError(error: unknown): NormalizedError {
  if (!error) return { message: 'Unknown error' };
  if (typeof error === 'string') return { message: error };
  const e = error as Record<string, unknown>;
  return {
    message: (e.message as string) ?? String(error),
    code: e.code as string | undefined,
    details: e.details as string | undefined,
    hint: e.hint as string | undefined,
  };
}

/**
 * Human-readable one-liner that keeps the Postgres code and hint when present,
 * e.g. `new row violates row-level security policy for table "sessions" [42501]`.
 * Suitable for a toast description.
 */
export function describeError(error: unknown): string {
  const { message, code, hint } = normalizeError(error);
  let out = message || 'Unknown error';
  if (code) out += ` [${code}]`;
  if (hint) out += ` — ${hint}`;
  return out;
}

/**
 * Central place to surface a failure so it is easy to see and fix:
 *   1. Logs full structured context to the console (visible in prod via
 *      browser devtools — including code/details/hint and the raw error).
 *   2. Shows the user a toast whose title is the action that failed and whose
 *      description is the real underlying error (not a generic message).
 *
 * Pass `{ toast: false }` to log only. Returns the human-readable description.
 */
export function reportError(
  context: string,
  error: unknown,
  opts: { toast?: boolean } = {},
): string {
  const normalized = normalizeError(error);
  // Single structured console line so production issues are obvious in devtools.
  console.error(`[FundFlow] ${context}:`, { ...normalized, raw: error });
  const description = describeError(error);
  if (opts.toast !== false) {
    toast.error(context, { description });
  }
  return description;
}
