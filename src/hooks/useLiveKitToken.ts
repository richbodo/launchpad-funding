import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TokenResult {
  token: string;
  ws_url: string;
  room: string;
}

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Exponential backoff with jitter so retries from many investors joining at
// once (cold starts / transient rate-limits during the go-live storm) spread
// out instead of hammering the edge function in lockstep.
const backoffMs = (attempt: number) => 400 * 2 ** (attempt - 1) + Math.random() * 300;

export function useLiveKitToken(
  sessionId: string,
  identity: string,
  name: string,
  role: string
) {
  const [result, setResult] = useState<TokenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  const fetchToken = useCallback(async () => {
    if (!sessionId || !identity || !role) return;

    cancelledRef.current = false;
    setLoading(true);
    setError(null);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('livekit-token', {
          body: { session_id: sessionId, identity, name, role },
        });

        if (cancelledRef.current) return;

        if (!fnErr && data?.token) {
          setResult(data as TokenResult);
          setLoading(false);
          return;
        }

        // Transient failure — retry with backoff unless this was the last try.
        if (attempt < MAX_ATTEMPTS) {
          await sleep(backoffMs(attempt));
          if (cancelledRef.current) return;
          continue;
        }
        setError(fnErr?.message || data?.error || 'Failed to get LiveKit token');
      } catch (err: any) {
        if (cancelledRef.current) return;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(backoffMs(attempt));
          if (cancelledRef.current) return;
          continue;
        }
        setError(err?.message || 'Failed to get LiveKit token');
      }
    }

    if (!cancelledRef.current) setLoading(false);
  }, [sessionId, identity, name, role]);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    token: result?.token ?? null,
    ws_url: result?.ws_url ?? null,
    room: result?.room ?? null,
    error,
    loading,
    fetchToken,
    reset,
  };
}
