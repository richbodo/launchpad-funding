/**
 * ConnectionReport — post-session diagnostic for facilitators.
 *
 * Reads the `livekit_reconnecting` / `livekit_reconnected` events written
 * by RoomEventLogger and pairs them per-participant to derive:
 *
 *   - total reconnect events
 *   - total time spent reconnecting (sum of reconnecting → reconnected gaps)
 *   - first / last reconnect timestamps
 *
 * Plus a session-wide rollup so the facilitator can see whether a session
 * had a single struggling user (network-side, not our problem) or
 * widespread issues (capacity / region / tier worth investigating).
 *
 * Single responsibility: pair events, render summary. No mutation.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Activity, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SessionOption {
  id: string;
  name: string;
  start_time: string | null;
}

interface RawLog {
  id: string;
  event_type: string;
  event_data: { email?: string; at?: string } | null;
  actor_email: string | null;
  created_at: string;
}

interface ParticipantSummary {
  email: string;
  reconnectCount: number;
  offlineMs: number;
  firstAt: string | null;
  lastAt: string | null;
}

/**
 * Pair sequential `reconnecting` → `reconnected` events per email and sum
 * the gaps. An unpaired trailing `reconnecting` (no recovery before the
 * fetch window ended) contributes its count but zero offline time — we
 * can't measure a duration we never observed completing.
 */
function summarize(logs: RawLog[]): ParticipantSummary[] {
  const byEmail = new Map<string, RawLog[]>();
  for (const log of logs) {
    const email = log.event_data?.email ?? log.actor_email ?? 'unknown';
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push(log);
  }

  const out: ParticipantSummary[] = [];
  for (const [email, rows] of byEmail) {
    // Oldest first for pairing.
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let reconnectCount = 0;
    let offlineMs = 0;
    let openAt: number | null = null;
    let firstAt: string | null = null;
    let lastAt: string | null = null;
    for (const r of rows) {
      if (r.event_type === 'livekit_reconnecting') {
        reconnectCount += 1;
        if (!firstAt) firstAt = r.created_at;
        lastAt = r.created_at;
        if (openAt === null) openAt = new Date(r.created_at).getTime();
      } else if (r.event_type === 'livekit_reconnected') {
        lastAt = r.created_at;
        if (openAt !== null) {
          offlineMs += new Date(r.created_at).getTime() - openAt;
          openAt = null;
        }
      }
    }
    out.push({ email, reconnectCount, offlineMs, firstAt, lastAt });
  }

  // Worst first — facilitator wants to see problem participants at the top.
  out.sort((a, b) => b.offlineMs - a.offlineMs || b.reconnectCount - a.reconnectCount);
  return out;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export default function ConnectionReport() {
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [summary, setSummary] = useState<ParticipantSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('sessions')
        .select('id, name, start_time')
        .order('start_time', { ascending: false })
        .limit(50);
      if (data) setSessions(data as SessionOption[]);
    })();
  }, []);

  const load = async (id: string) => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from('session_logs')
      .select('id, event_type, event_data, actor_email, created_at')
      .eq('session_id', id)
      .in('event_type', ['livekit_reconnecting', 'livekit_reconnected'])
      .order('created_at', { ascending: true })
      .limit(2000);
    setSummary(summarize((data as RawLog[] | null) ?? []));
    setLoading(false);
  };

  useEffect(() => {
    if (sessionId) void load(sessionId);
  }, [sessionId]);

  const totalParticipantsAffected = summary.filter((s) => s.reconnectCount > 0).length;
  const worst = summary[0];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" /> Connection Report
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(sessionId)}
          disabled={!sessionId || loading}
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Session</label>
          <Select value={sessionId} onValueChange={setSessionId}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Pick a session…" />
            </SelectTrigger>
            <SelectContent>
              {sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.start_time ? ` · ${new Date(s.start_time).toLocaleDateString()}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {sessionId && !loading && summary.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No reconnect events recorded for this session — everyone stayed connected. 🎉
          </p>
        )}

        {summary.length > 0 && (
          <>
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <strong>{totalParticipantsAffected}</strong> of {summary.length} participants had ≥1 reconnect.
              {worst && worst.reconnectCount > 0 && (
                <>
                  {' '}Worst: <strong>{worst.email}</strong> with {worst.reconnectCount} event
                  {worst.reconnectCount === 1 ? '' : 's'} / {formatDuration(worst.offlineMs)} offline.
                </>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Participant</TableHead>
                  <TableHead className="text-right">Reconnects</TableHead>
                  <TableHead className="text-right">Time Offline</TableHead>
                  <TableHead>First</TableHead>
                  <TableHead>Last</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((p) => (
                  <TableRow key={p.email}>
                    <TableCell className="text-sm">{p.email}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{p.reconnectCount}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatDuration(p.offlineMs)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.firstAt ? new Date(p.firstAt).toLocaleTimeString() : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.lastAt ? new Date(p.lastAt).toLocaleTimeString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export { summarize as __test_summarize };
