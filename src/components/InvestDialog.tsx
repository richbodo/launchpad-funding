import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { DollarSign, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface InvestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  startupName: string;
  startupEmail: string;
}

export default function InvestDialog({ open, onOpenChange, sessionId, startupName, startupEmail }: InvestDialogProps) {
  const { user } = useSessionUser();
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleInvest = async () => {
    if (!amount || !user) return;
    setSubmitting(true);

    await supabase.from('investments').insert({
      session_id: sessionId,
      investor_email: user.email,
      investor_name: user.displayName,
      startup_email: startupEmail,
      startup_name: startupName,
      amount: parseFloat(amount),
    });

    // Log the event
    await supabase.from('session_logs').insert({
      session_id: sessionId,
      event_type: 'investment',
      event_data: { investor: user.email, startup: startupEmail, amount: parseFloat(amount) },
      actor_email: user.email,
    });

    setSubmitting(false);
    setSubmitted(true);
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setSubmitted(false);
      setAmount('');
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <AnimatePresence mode="wait">
          {!submitted ? (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-funding" />
                  Invest in {startupName}
                </DialogTitle>
                <DialogDescription>
                  Enter your soft commitment amount. This is a non-binding pledge of interest.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="amount">Commitment Amount (USD)</Label>
                  <div className="relative mt-1.5">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                    <Input
                      data-testid="invest-amount-input"
                      id="amount"
                      type="number"
                      min="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="25,000"
                      className="pl-7 mono text-lg bg-muted/50"
                    />
                  </div>
                </div>

                <Button
                  data-testid="invest-confirm-btn"
                  onClick={handleInvest}
                  disabled={!amount || submitting}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90 h-11 text-base font-semibold"
                >
                  {submitting ? 'Submitting...' : 'Confirm Commitment'}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-4"
            >
              <CheckCircle2 className="w-12 h-12 text-funding mx-auto mb-3" />
              <h3 className="text-lg font-bold">Commitment Recorded!</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                You've pledged <span className="font-semibold mono text-foreground">${parseFloat(amount).toLocaleString()}</span> to{' '}
                <span className="font-semibold text-foreground">{startupName}</span>
              </p>
              <div className="mt-4 p-3 rounded-lg bg-muted text-sm text-left space-y-1">
                <p><span className="text-muted-foreground">Startup:</span> {startupName}</p>
                <p><span className="text-muted-foreground">Contact:</span> {startupEmail}</p>
                <p><span className="text-muted-foreground">Your email:</span> {user?.email}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-3">An email confirmation has been sent to both parties.</p>
              <Button onClick={handleClose} variant="outline" className="mt-4">
                Done
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
