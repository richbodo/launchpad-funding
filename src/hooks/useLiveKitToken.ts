import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TokenResult {
  token: string;
  ws_url: string;
  room: string;
}

/**
 * Fetches a LiveKit room-join token from the `livekit-token` edge function.
 *
 * Server derives session/identity/role from the participant session token
 * minted at login — we intentionally do NOT send session_id / identity /
 * role from the client anymore (security finding: livekit_identity_spoof).
 */
export function useLiveKitToken(
  _sessionId: string,
  _identity: string,
  name: string,
  _role: string,
  participantToken: string | null | undefined,
) {
  const [result, setResult] = useState<TokenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  const fetchToken = useCallback(async () => {
    if (!participantToken) return;

    cancelledRef.current = false;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('livekit-token', {
        body: { participant_token: participantToken, name },
      });

      if (cancelledRef.current) return;

      if (fnErr || !data?.token) {
        setError(fnErr?.message || data?.error || 'Failed to get LiveKit token');
        return;
      }

      setResult(data as TokenResult);
    } catch (err: any) {
      if (!cancelledRef.current) {
        setError(err.message || 'Failed to get LiveKit token');
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [name, participantToken]);

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
