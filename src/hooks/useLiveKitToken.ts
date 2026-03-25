import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TokenResult {
  token: string;
  ws_url: string;
  room: string;
}

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

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('livekit-token', {
        body: { session_id: sessionId, identity, name, role },
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
