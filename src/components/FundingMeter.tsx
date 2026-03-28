import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

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

// Thermometer segments: green → yellow → orange → red-orange → red
const THERMO_SEGMENTS = [
  { color: 'hsl(145, 70%, 42%)' },   // green
  { color: 'hsl(100, 55%, 45%)' },   // yellow-green
  { color: 'hsl(55, 70%, 50%)' },    // yellow
  { color: 'hsl(35, 80%, 50%)' },    // orange
  { color: 'hsl(15, 75%, 50%)' },    // red-orange
  { color: 'hsl(0, 70%, 50%)' },     // red
];

export default function FundingMeter({ totalFunded, currentStartup, startupFunded }: FundingMeterProps) {
  const pct = Math.min((totalFunded / 1_000_000) * 100, 100);

  return (
    <div className="w-full bg-card border-b border-border px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Total session funding */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-funding/10">
            <TrendingUp className="w-5 h-5 text-funding" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Funds Committed</p>
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

        {/* Thermometer bar */}
        <div className="flex-1 max-w-xl hidden md:block">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Fund-ometer</span>
            <span className="text-xs font-medium text-funding mono">{formatCurrency(totalFunded)}</span>
          </div>
          <div className="flex items-center gap-0">
            {/* Bulb */}
            <div
              className="w-6 h-6 rounded-full shrink-0 border-2 border-background shadow-md"
              style={{ background: THERMO_SEGMENTS[0].color }}
            />
            {/* Segments */}
            <div className="flex-1 h-4 flex overflow-hidden rounded-r-full -ml-1" data-testid="funding-meter-bar">
              {THERMO_SEGMENTS.map((seg, i) => {
                const segStart = (i / THERMO_SEGMENTS.length) * 100;
                const segEnd = ((i + 1) / THERMO_SEGMENTS.length) * 100;
                const fillPct = pct <= segStart ? 0 : pct >= segEnd ? 100 : ((pct - segStart) / (segEnd - segStart)) * 100;

                return (
                  <div key={i} className="flex-1 relative" style={{ background: 'hsl(var(--muted))' }}>
                    <motion.div
                      className="absolute inset-y-0 left-0"
                      style={{ background: seg.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${fillPct}%` }}
                      transition={{ type: 'spring', stiffness: 50, damping: 15 }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Current startup - no redundant amount */}
        {currentStartup && (
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider text-right">Now Presenting</p>
              <p className="text-sm font-semibold text-right">{currentStartup}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
