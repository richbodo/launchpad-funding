import { motion } from 'framer-motion';
import { DollarSign, TrendingUp } from 'lucide-react';

interface FundingMeterProps {
  totalFunded: number;
  currentStartup: string;
  startupFunded: number;
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

export default function FundingMeter({ totalFunded, currentStartup, startupFunded }: FundingMeterProps) {
  return (
    <div className="w-full bg-card border-b border-border px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Total session funding */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-funding/10">
            <TrendingUp className="w-5 h-5 text-funding" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Session Total</p>
            <motion.p
              key={totalFunded}
              initial={{ scale: 1.2, color: 'hsl(155 70% 45%)' }}
              animate={{ scale: 1, color: 'hsl(var(--foreground))' }}
              className="text-2xl font-bold mono"
            >
              {formatCurrency(totalFunded)}
            </motion.p>
          </div>
        </div>

        {/* Funding bar */}
        <div className="flex-1 max-w-xl hidden md:block">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Live Commitments</span>
            <span className="text-xs font-medium text-funding mono">{formatCurrency(totalFunded)}</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-funding to-funding-glow funding-glow"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((totalFunded / 1_000_000) * 100, 100)}%` }}
              transition={{ type: 'spring', stiffness: 50, damping: 15 }}
            />
          </div>
        </div>

        {/* Current startup funding */}
        {currentStartup && (
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider text-right">Now Presenting</p>
              <p className="text-sm font-semibold text-right">{currentStartup}</p>
            </div>
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-funding/10">
              <DollarSign className="w-5 h-5 text-funding" />
            </div>
            <motion.p
              key={startupFunded}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              className="text-lg font-bold mono text-funding"
            >
              {formatCurrency(startupFunded)}
            </motion.p>
          </div>
        )}
      </div>
    </div>
  );
}
