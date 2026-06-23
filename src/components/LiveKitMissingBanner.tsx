import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Banner shown to facilitators when LiveKit isn't configured.
 *
 * LiveKit is the only external (non-Lovable) dependency FundFlow needs:
 * a remixed app boots with no `VITE_LIVEKIT_WS_URL` and no
 * `LIVEKIT_*` edge-function secrets, which silently breaks video. This
 * banner makes the missing config visible to the facilitator with a
 * direct link to the setup doc instead of failing quietly inside the
 * <LiveKitRoom> on the session page.
 *
 * The signal we check on the client is `VITE_LIVEKIT_WS_URL` — that
 * env var is what `useLiveKitToken` and `<LiveKitRoom>` need at runtime.
 * The server-side secrets (LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
 * LIVEKIT_WS_URL) are validated lazily by the `livekit-token` edge
 * function; if those are missing the token request will 500, but the
 * banner is the first hint that the operator forgot the LiveKit step.
 */
export default function LiveKitMissingBanner() {
  const [dismissed, setDismissed] = useState(false);
  const wsUrl = import.meta.env.VITE_LIVEKIT_WS_URL as string | undefined;

  if (dismissed || (wsUrl && wsUrl.length > 0)) return null;

  return (
    <div className="w-full bg-yellow-500/15 border-b border-yellow-500/40 text-yellow-100 px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">
          <strong>LiveKit is not configured.</strong> Video calls will not work until you add your
          LiveKit credentials.{' '}
          <a
            href="https://github.com/richbodo/fundflow/blob/main/docs/livekit-setup.md"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:opacity-90"
          >
            Setup guide →
          </a>
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 rounded hover:bg-yellow-500/20"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
