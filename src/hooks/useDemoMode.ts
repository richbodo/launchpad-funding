import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Module-level cache for the demo-mode flag.
 *
 * Previously every mount of every component using `useDemoMode` (Login,
 * EventLanding, DemoModeBanner, HelpButton, Admin) issued its own
 * `select value from app_settings where key='mode'` round trip. On a
 * page with 2–3 such components this multiplied REST calls and added
 * perceptible latency to first paint. We now resolve the flag once per
 * page load and share the promise across consumers.
 *
 * The cache intentionally lives for the lifetime of the JS module
 * (i.e. until full page reload). Demo mode is toggled rarely and only
 * from the Admin page, which already refreshes its own local state.
 */
let cachedPromise: Promise<boolean> | null = null;

async function fetchDemoModeOnce(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'mode')
      .single();
    return data?.value === 'demo';
  } catch {
    return false;
  }
}

function fetchDemoMode(): Promise<boolean> {
  if (!cachedPromise) cachedPromise = fetchDemoModeOnce();
  return cachedPromise;
}

/** Test/Admin escape hatch — invalidate after toggling demo mode. */
export function clearDemoModeCache() {
  cachedPromise = null;
}

export function useDemoMode() {
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchDemoMode().then((value) => {
      if (cancelled) return;
      setIsDemoMode(value);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { isDemoMode, loading };
}
