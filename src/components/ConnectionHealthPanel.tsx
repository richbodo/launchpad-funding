/**
 * Facilitator-only condensed connection-health indicator.
 *
 * Renders as a single pill in the session header — green dot + count when
 * everyone is fine, amber/red with an issue count otherwise. Clicking the
 * pill opens a popover with one row per remote participant: state dot,
 * name, quality / RTT / loss summary, reconnect count, and a Nudge menu.
 *
 * Designed for a facilitator who is *in* the call: the pill is small enough
 * to glance at between moments of focus, and the popover collapses the per-
 * participant detail so the facilitator only sees specifics when they
 * deliberately drill in.
 */

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ConnectionQuality } from 'livekit-client';
import { Activity } from 'lucide-react';
import { useConnectionHealth, type HealthState, type ParticipantHealth } from '@/hooks/useConnectionHealth';
import { NUDGES, sendNudge, type NudgeId } from '@/lib/connectionNudges';
import { toast } from 'sonner';

interface Props {
  sessionId: string;
  facilitatorEmail: string;
  facilitatorName: string | null;
  /**
   * Optional callback so the panel can trigger a local soft-retry on a
   * specific participant's VideoPane (the 'refresh_tile' nudge). Wired by
   * Session.tsx — bubbles up via a shared ref/event because VideoPanes are
   * scattered across panes.
   */
  onRefreshTile?: (identity: string) => void;
}

const dotClass = (state: HealthState): string => {
  switch (state) {
    case 'healthy':
      return 'bg-emerald-500';
    case 'degraded':
      return 'bg-amber-500';
    case 'failing':
      return 'bg-red-500';
    case 'stuck':
      return 'bg-red-500 animate-pulse';
  }
};

const qualityLabel = (q: ConnectionQuality | undefined): string => {
  switch (q) {
    case ConnectionQuality.Excellent:
      return 'Excellent';
    case ConnectionQuality.Good:
      return 'Good';
    case ConnectionQuality.Poor:
      return 'Poor';
    case ConnectionQuality.Lost:
      return 'Lost';
    default:
      return '—';
  }
};

/**
 * Build the compact metrics summary shown on each row, e.g.
 *   "Good · 80ms · 0% loss · 1 reconnect"
 * Empty bits drop out so we never render "Good · — · —".
 */
const buildRowSummary = (h: ParticipantHealth): string => {
  const bits: string[] = [qualityLabel(h.quality)];
  if (h.rttMs !== undefined) bits.push(`${h.rttMs}ms`);
  if (h.lossPct !== undefined) bits.push(`${h.lossPct.toFixed(1)}% loss`);
  if (h.reconnectCount > 0)
    bits.push(`${h.reconnectCount} reconnect${h.reconnectCount === 1 ? '' : 's'}`);
  return bits.join(' · ');
};

export default function ConnectionHealthPanel({
  sessionId,
  facilitatorEmail,
  facilitatorName,
  onRefreshTile,
}: Props) {
  const { byIdentity, counts, worst } = useConnectionHealth();
  const [open, setOpen] = useState(false);

  const total = byIdentity.size;
  const issueCount = counts.degraded + counts.failing + counts.stuck;

  const pillLabel =
    total === 0
      ? 'No remote participants'
      : issueCount === 0
        ? `${total} healthy`
        : `${issueCount} issue${issueCount === 1 ? '' : 's'}`;

  const handleNudge = async (h: ParticipantHealth, nudgeId: NudgeId) => {
    if (nudgeId === 'refresh_tile') {
      // Broadcast to any VideoPane matching this identity. Decoupled this
      // way so the panel doesn't need a ref to every pane (they live in
      // multiple parts of the layout: facilitator stack, stage, startup grid).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('lk-soft-retry-tile', { detail: { identity: h.identity } }),
        );
      }
      onRefreshTile?.(h.identity);
      toast.success(`Refreshed ${h.name}'s tile`);
      return;
    }
    const res = await sendNudge({
      sessionId,
      facilitatorEmail,
      facilitatorName,
      targetName: h.name,
      nudgeId,
    });
    if (res.ok) toast.success(`Sent nudge to ${h.name}`);
    else toast.error(`Could not send nudge: ${res.error ?? 'unknown'}`);
  };

  const rows = Array.from(byIdentity.values()).sort((a, b) => {
    // Worst first so the facilitator's eye lands on the people who need help.
    const order: HealthState[] = ['stuck', 'failing', 'degraded', 'healthy'];
    return order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name);
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 gap-1.5"
          aria-label={`Connection health: ${pillLabel}`}
          data-testid="connection-health-pill"
        >
          <Activity className="w-3.5 h-3.5" />
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass(worst)}`} />
          <span className="text-xs tabular-nums">{total}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-[360px] p-0"
        data-testid="connection-health-popover"
      >
        <div className="px-3 py-2 border-b border-border">
          <p className="text-sm font-semibold">Connection Health</p>
          <p className="text-[11px] text-muted-foreground">
            {total} remote · {pillLabel}
          </p>
        </div>
        <div className="max-h-[320px] overflow-auto py-1">
          {rows.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              No other participants are connected yet.
            </p>
          )}
          {rows.map((h) => (
            <div
              key={h.identity}
              className="px-3 py-2 flex items-center gap-2 hover:bg-muted/40"
              data-testid={`connection-health-row-${h.identity}`}
            >
              <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotClass(h.state)}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{h.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{buildRowSummary(h)}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant={h.state === 'healthy' ? 'ghost' : 'outline'}
                    className="h-7 text-[11px] px-2"
                  >
                    Nudge
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Try in order
                  </DropdownMenuLabel>
                  {NUDGES.map((n, i) => (
                    <div key={n.id}>
                      {i === 2 && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        onClick={() => void handleNudge(h, n.id)}
                        className="text-xs"
                      >
                        <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}.</span>
                        {n.label}
                      </DropdownMenuItem>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
          Nudges post into chat as suggestions — the participant decides whether to act.
        </div>
      </PopoverContent>
    </Popover>
  );
}
