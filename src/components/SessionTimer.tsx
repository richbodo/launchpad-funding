import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface SessionTimerProps {
  startTime: string;
  endTime: string;
  currentPhase: string;
  phaseEndTime: Date;
}

export default function SessionTimer({ currentPhase, phaseEndTime }: SessionTimerProps) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const tick = () => {
      const diff = phaseEndTime.getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('00:00');
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phaseEndTime]);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{currentPhase}</span>
      <span className="mono text-sm font-bold text-foreground">{remaining}</span>
    </div>
  );
}
