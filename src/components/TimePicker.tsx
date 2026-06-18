import { Clock } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Format a 24-hour "HH:mm" value as a friendly 12-hour label, e.g. "9:00 AM". */
function to12Hour(value: string): string {
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  const m = mStr ?? '00';
  if (Number.isNaN(h)) return value;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

/** Build "HH:mm" options every `stepMinutes` across a 24-hour day. */
function buildOptions(stepMinutes: number): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += stepMinutes) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      opts.push({ value, label: to12Hour(value) });
    }
  }
  return opts;
}

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Granularity of the options in minutes. Defaults to 15. */
  stepMinutes?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * A dropdown time picker built on shadcn Select. Unlike a native <input
 * type="time">, it is unambiguously a clickable picker (clock icon + chevron)
 * and the open list scrolls with visible up/down scroll buttons. The bound
 * value stays in 24-hour "HH:mm" form so existing date parsing is unchanged.
 */
export default function TimePicker({
  value,
  onChange,
  stepMinutes = 15,
  disabled = false,
  id,
  className,
}: TimePickerProps) {
  const options = buildOptions(stepMinutes);
  // If the current value doesn't fall on a step boundary (e.g. seeded data),
  // surface it as an extra option so the trigger still shows a label.
  const hasValue = !value || options.some((o) => o.value === value);
  const allOptions = hasValue
    ? options
    : [{ value, label: to12Hour(value) }, ...options];

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={className ?? 'mt-1'} aria-label="Select time">
        <Clock className="mr-2 h-4 w-4 shrink-0 opacity-60" />
        <SelectValue placeholder="Select time" />
      </SelectTrigger>
      <SelectContent>
        {allOptions.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
