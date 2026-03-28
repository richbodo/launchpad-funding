import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';

type Status = 'loading' | 'valid' | 'already_unsubscribed' | 'invalid' | 'success' | 'error';

export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>('loading');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    const validate = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${token}`,
          { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
        );
        const data = await res.json();
        if (!res.ok) { setStatus('invalid'); return; }
        if (data.valid === false && data.reason === 'already_unsubscribed') {
          setStatus('already_unsubscribed');
        } else if (data.valid) {
          setStatus('valid');
        } else {
          setStatus('invalid');
        }
      } catch { setStatus('error'); }
    };
    validate();
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('handle-email-unsubscribe', {
        body: { token },
      });
      if (error) throw error;
      setStatus(data?.success ? 'success' : 'error');
    } catch { setStatus('error'); }
    setProcessing(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            {status === 'loading' && <p className="text-muted-foreground">Validating…</p>}
            {status === 'valid' && (
              <>
                <h2 className="text-lg font-semibold">Unsubscribe</h2>
                <p className="text-sm text-muted-foreground">Are you sure you want to unsubscribe from future emails?</p>
                <Button onClick={handleUnsubscribe} disabled={processing} variant="destructive" className="w-full">
                  {processing ? 'Processing…' : 'Confirm Unsubscribe'}
                </Button>
              </>
            )}
            {status === 'success' && (
              <>
                <h2 className="text-lg font-semibold text-accent">Unsubscribed</h2>
                <p className="text-sm text-muted-foreground">You won't receive any more emails from us.</p>
              </>
            )}
            {status === 'already_unsubscribed' && (
              <>
                <h2 className="text-lg font-semibold">Already Unsubscribed</h2>
                <p className="text-sm text-muted-foreground">You've already been unsubscribed.</p>
              </>
            )}
            {status === 'invalid' && (
              <>
                <h2 className="text-lg font-semibold text-destructive">Invalid Link</h2>
                <p className="text-sm text-muted-foreground">This unsubscribe link is invalid or has expired.</p>
              </>
            )}
            {status === 'error' && (
              <>
                <h2 className="text-lg font-semibold text-destructive">Error</h2>
                <p className="text-sm text-muted-foreground">Something went wrong. Please try again later.</p>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
