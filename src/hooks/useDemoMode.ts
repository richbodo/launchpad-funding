import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useDemoMode() {
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'mode')
        .single();
      setIsDemoMode(data?.value === 'demo');
      setLoading(false);
    };
    fetch();
  }, []);

  return { isDemoMode, loading };
}
