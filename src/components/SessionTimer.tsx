import { Clock, Pause } from 'lucide-react';

interface SessionTimerProps {
  currentPhase: string;
  remainingSeconds: number;
  isPaused?: boolean;
}

export default function SessionTimer({ currentPhase, remainingSeconds, isPaused }: SessionTimerProps) {
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
      {isPaused ? (
        <Pause className="w-3.5 h-3.5 text-muted-foreground" />
      ) : (
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
      )}
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{currentPhase}</span>
      <span className="mono text-sm font-bold text-foreground">{formatted}</span>
    </div>
  );
}
