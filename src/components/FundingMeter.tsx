import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

interface FundingMeterProps {
  startupFunded: number;
  fundingGoal: number | null;
  currentStartup: string;
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.ceil(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

const BAR_COLOR = 'hsl(155, 70%, 45%)';

export default function FundingMeter({ startupFunded, fundingGoal, currentStartup }: FundingMeterProps) {
  const hasGoal = fundingGoal != null && fundingGoal > 0;
  const pct = hasGoal ? Math.min((startupFunded / fundingGoal) * 100, 100) : 0;
  const isOversubscribed = hasGoal && startupFunded > fundingGoal;
  const overage = isOversubscribed ? startupFunded - fundingGoal : 0;
  const isSessionTotal = !currentStartup;

  return (
    <div className="w-full bg-card border-b border-border px-4 py-3">
      {/* Oversubscription banner */}
      {isOversubscribed && (
        <div className="max-w-7xl mx-auto mb-2">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-sm font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1"
            data-testid="oversubscribed-banner"
          >
            Oversubscribed: {formatCurrency(overage)}
          </motion.div>
        </div>
      )}

      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Funding amount */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-funding/10">
            <TrendingUp className="w-5 h-5 text-funding" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {isSessionTotal ? 'Total Raised' : 'Pledged'}
            </p>
            <motion.p
              key={startupFunded}
              initial={{ scale: 1.2, color: BAR_COLOR }}
              animate={{ scale: 1, color: 'hsl(var(--foreground))' }}
              className="text-2xl font-bold mono"
              data-testid="funding-amount"
            >
              {formatCurrency(startupFunded)}
            </motion.p>
          </div>
        </div>

        {/* Progress bar — only shown when a goal is set */}
        {hasGoal && (
          <div className="flex-1 max-w-xl hidden md:block">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Progress</span>
              <span className="text-xs font-medium text-funding mono">{Math.round(pct)}%</span>
            </div>
            <div className="h-4 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }} data-testid="funding-meter-bar">
              <motion.div
                className="h-full rounded-full"
                style={{ background: BAR_COLOR }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: 'spring', stiffness: 50, damping: 15 }}
                data-testid="funding-meter-fill"
              />
            </div>
          </div>
        )}

        {/* Goal and startup name */}
        <div className="flex items-center gap-3">
          <div>
            {currentStartup && (
              <p className="text-xs text-muted-foreground uppercase tracking-wider text-right">Now Presenting</p>
            )}
            {currentStartup && (
              <p className="text-sm font-semibold text-right">{currentStartup}</p>
            )}
            {hasGoal && (
              <p className="text-xs text-muted-foreground text-right mt-0.5" data-testid="funding-goal">
                Goal: {formatCurrency(fundingGoal)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
