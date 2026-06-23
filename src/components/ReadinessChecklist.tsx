/**
 * ReadinessChecklist
 * ------------------
 * Small visual checklist used on the Green Room to tell startups and
 * facilitators which profile fields they still need to fill in. Each item
 * has a "required" flag — only required items must be ✓ for the participant
 * to be considered "ready", but optional items still render so users know
 * what's available.
 */
import { Check, Circle } from 'lucide-react';

export interface ChecklistItem {
  label: string;
  done: boolean;
  required?: boolean;
}

interface Props {
  title?: string;
  items: ChecklistItem[];
}

export default function ReadinessChecklist({ title = 'Pre-flight checklist', items }: Props) {
  const requiredDone = items.filter(i => i.required).every(i => i.done);
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span
          className={
            'text-xs font-medium px-2 py-0.5 rounded ' +
            (requiredDone
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-400 border border-amber-500/30')
          }
        >
          {requiredDone ? 'Ready' : 'Needs attention'}
        </span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            {item.done ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground/60" />
            )}
            <span className={item.done ? 'text-foreground/90' : 'text-foreground/70'}>
              {item.label}
            </span>
            {item.required && !item.done && (
              <span className="text-[10px] uppercase tracking-wide text-amber-400 ml-auto">required</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
