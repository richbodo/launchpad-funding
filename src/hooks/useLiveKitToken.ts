import { useState, useEffect } from 'react';
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !identity || !role) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchToken = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('livekit-token', {
          body: { session_id: sessionId, identity, name, role },
        });

        if (cancelled) return;

        if (fnErr || !data?.token) {
          setError(fnErr?.message || data?.error || 'Failed to get LiveKit token');
          setLoading(false);
          return;
        }

        setResult(data as TokenResult);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to get LiveKit token');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchToken();
    return () => { cancelled = true; };
  }, [sessionId, identity, name, role]);

  return { ...result, error, loading };
}
