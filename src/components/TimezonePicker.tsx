import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Fallback list used only if the browser lacks Intl.supportedValuesOf
 * (older browsers). Modern browsers return the full IANA database instead.
 */
const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Phoenix',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];

/** Full IANA timezone list when available, otherwise the curated fallback. */
function listTimezones(): string[] {
  try {
    const supported = (Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf;
    if (typeof supported === 'function') {
      const zones = supported('timeZone');
      if (zones?.length) return zones;
    }
  } catch {
    /* fall through to fallback */
  }
  return FALLBACK_TIMEZONES;
}

interface TimezonePickerProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
}

/**
 * Searchable timezone combobox (shadcn Popover + Command). The user can only
 * pick a valid IANA timezone from the list — no free-text guessing at the
 * format — and can type to filter, e.g. "york" → America/New_York.
 */
export default function TimezonePicker({
  value,
  onChange,
  id,
  className,
}: TimezonePickerProps) {
  const [open, setOpen] = useState(false);
  const timezones = useMemo(listTimezones, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className ?? 'mt-1')}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 opacity-60" />
            <span className="truncate">{value || 'Select timezone'}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search timezone..." />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {timezones.map((tz) => (
                <CommandItem
                  key={tz}
                  value={tz}
                  onSelect={() => {
                    onChange(tz);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === tz ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {tz}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
