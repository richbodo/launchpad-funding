import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { DollarSign, CheckCircle2, Gift } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export type PledgeType = 'equity' | 'gift';

interface InvestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  startupName: string;
  startupEmail: string;
  /**
   * Issue #41 — selects the dialog mode:
   *  - 'equity' : accredited investor placing a binding-intent commitment (no cap).
   *  - 'gift'   : community supporter pledging a best-effort gift (max $100).
   * Defaults to 'equity' to preserve existing call sites.
   */
  pledgeType?: PledgeType;
}

// Issue #41: non-binding gift pledges from community supporters are capped
// at $100 per the issue spec. Equity commitments remain uncapped.
const GIFT_MAX_USD = 100;

export default function InvestDialog({
  open,
  onOpenChange,
  sessionId,
  startupName,
  startupEmail,
  pledgeType = 'equity',
}: InvestDialogProps) {
  const { user } = useSessionUser();
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isGift = pledgeType === 'gift';
  const amt = parseFloat(amount);
  const amountValid = !Number.isNaN(amt) && amt > 0 && (!isGift || amt <= GIFT_MAX_USD);

  const handleInvest = async () => {
    if (!amountValid || !user) return;
    if (isGift && amt > GIFT_MAX_USD) return;
    setSubmitting(true);

    // Single server-verified RPC: the DB function inserts the investment row,
    // the commit chat banner, and the audit log in one transaction using the
    // caller identity resolved from the participant session token (not from
    // a client-supplied email). See migration
    // 20260708_security_hardening for the SECURITY DEFINER definition.
    const { error: rpcError } = await supabase.rpc('submit_investment', {
      _token: user.token ?? '',
      _startup_email: startupEmail,
      _startup_name: startupName,
      _amount: amt,
      _pledge_type: pledgeType,
    });
    if (rpcError) {
      setSubmitting(false);
      alert(isGift
        ? `Pledge rejected: ${rpcError.message}`
        : `Pledge could not be recorded: ${rpcError.message}`);
      return;
    }

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

  const titleIcon = isGift
    ? <Gift className="w-5 h-5 text-funding" />
    : <DollarSign className="w-5 h-5 text-funding" />;
  const title = isGift ? `Pledge a gift to ${startupName}` : `Invest in ${startupName}`;
  const description = isGift
    ? `Non-binding best-effort pledge. The startup may offer a gift in return. Max $${GIFT_MAX_USD}.`
    : 'Enter your soft commitment amount. This is a non-binding pledge of interest.';
  const amountLabel = isGift ? `Pledge Amount (USD, max $${GIFT_MAX_USD})` : 'Commitment Amount (USD)';
  const confirmLabel = isGift ? 'Confirm Pledge' : 'Confirm Commitment';
  const placeholder = isGift ? '50' : '25,000';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <AnimatePresence mode="wait">
          {!submitted ? (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {titleIcon}
                  {title}
                </DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="amount">{amountLabel}</Label>
                  <div className="relative mt-1.5">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                    <Input
                      data-testid="invest-amount-input"
                      id="amount"
                      type="number"
                      min="1"
                      max={isGift ? GIFT_MAX_USD : undefined}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={placeholder}
                      className="pl-7 mono text-lg bg-muted/50"
                    />
                  </div>
                  {isGift && amount && !amountValid && (
                    <p className="text-xs text-destructive mt-1" data-testid="gift-cap-warning">
                      Community gift pledges are capped at ${GIFT_MAX_USD}.
                    </p>
                  )}
                </div>

                <Button
                  data-testid="invest-confirm-btn"
                  onClick={handleInvest}
                  disabled={!amountValid || submitting}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90 h-11 text-base font-semibold"
                >
                  {submitting ? 'Submitting...' : confirmLabel}
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
              <h3 className="text-lg font-bold">
                {isGift ? 'Gift Pledge Recorded!' : 'Commitment Recorded!'}
              </h3>
              <p className="text-muted-foreground mt-2 text-sm">
                You've {isGift ? 'pledged a gift of' : 'pledged'}{' '}
                <span className="font-semibold mono text-foreground">${parseFloat(amount).toLocaleString()}</span> to{' '}
                <span className="font-semibold text-foreground">{startupName}</span>
              </p>
              <div className="mt-4 p-3 rounded-lg bg-muted text-sm text-left space-y-1">
                <p><span className="text-muted-foreground">Startup:</span> {startupName}</p>
                <p><span className="text-muted-foreground">Contact:</span> {startupEmail}</p>
                <p><span className="text-muted-foreground">Your email:</span> {user?.email}</p>
                <p><span className="text-muted-foreground">Type:</span> {isGift ? 'Community gift (best-effort)' : 'Equity commitment'}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-3">An email confirmation will be sent to both of you at the end of the session, once the facilitator approves the queued emails.</p>
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
