/**
 * useConnectionHealth — facilitator-side telemetry for every remote
 * participant in the current LiveKit room.
 *
 * Single responsibility: produce a stable, classified snapshot of every
 * remote participant's connection state so the facilitator can see at a
 * glance who needs help. No DB writes, no UI — pure derived state.
 *
 * Inputs:
 *   - LiveKit participants (live, via useParticipants)
 *   - LiveKit RoomEvent.Reconnecting / Reconnected per remote identity
 *   - Optional per-track WebRTC stats sampled every 5s (RTT, loss, jitter)
 *
 * Output: Map<identity, ParticipantHealth>.
 *
 * Classifier (worst-of):
 *   - quality === Lost                                → 'stuck' (red, pulse)
 *   - quality === Poor   OR loss > 5%  OR rtt > 300  → 'failing' (red)
 *   - quality === Good   OR loss > 2%  OR rtt > 200  → 'degraded' (amber)
 *   - otherwise                                       → 'healthy' (green)
 *   - any active reconnecting flag overrides to 'stuck'
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParticipants, useRoomContext } from '@livekit/components-react';
import { ConnectionQuality, RoomEvent, type RemoteParticipant } from 'livekit-client';

export type HealthState = 'healthy' | 'degraded' | 'failing' | 'stuck';

export interface ParticipantHealth {
  identity: string;
  name: string;
  /** Coarse classifier — drives the dot color. */
  state: HealthState;
  /** Raw LiveKit quality, surfaced for display. */
  quality: ConnectionQuality | undefined;
  /** Round-trip-time in ms (best available), undefined if unknown. */
  rttMs: number | undefined;
  /** Loss as a percent 0-100, undefined if unknown. */
  lossPct: number | undefined;
  /** Total reconnect events observed for this identity this session. */
  reconnectCount: number;
  /** True while an active reconnecting cycle is in-flight. */
  isReconnecting: boolean;
}

const SAMPLE_INTERVAL_MS = 5_000;

interface RawStats {
  rttMs?: number;
  lossPct?: number;
}

/**
 * Pull RTT + loss from a RemoteParticipant's track publications using the
 * standard RTCPeerConnection getStats() API. We aggregate across audio +
 * video inbound-rtp reports and pick the worst loss / max RTT — that's
 * what the facilitator actually cares about ("is this person struggling").
 */
async function sampleParticipantStats(p: RemoteParticipant): Promise<RawStats> {
  const out: RawStats = {};
  let totalLost = 0;
  let totalReceived = 0;
  let maxRtt: number | undefined;

  const pubs = Array.from(p.trackPublications.values());
  for (const pub of pubs) {
    const track = pub.track as { getRTCStatsReport?: () => Promise<RTCStatsReport> } | undefined;
    if (!track?.getRTCStatsReport) continue;
    let report: RTCStatsReport;
    try {
      report = await track.getRTCStatsReport();
    } catch {
      continue;
    }
    report.forEach((stat: any) => {
      if (stat.type === 'inbound-rtp') {
        if (typeof stat.packetsLost === 'number') totalLost += stat.packetsLost;
        if (typeof stat.packetsReceived === 'number') totalReceived += stat.packetsReceived;
      }
      if (stat.type === 'remote-inbound-rtp' && typeof stat.roundTripTime === 'number') {
        const rttMs = stat.roundTripTime * 1000;
        if (maxRtt === undefined || rttMs > maxRtt) maxRtt = rttMs;
      }
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && typeof stat.currentRoundTripTime === 'number') {
        const rttMs = stat.currentRoundTripTime * 1000;
        if (maxRtt === undefined || rttMs > maxRtt) maxRtt = rttMs;
      }
    });
  }

  if (totalReceived + totalLost > 0) {
    out.lossPct = (totalLost / (totalLost + totalReceived)) * 100;
  }
  if (maxRtt !== undefined) out.rttMs = Math.round(maxRtt);
  return out;
}

function classify(args: {
  quality: ConnectionQuality | undefined;
  rttMs: number | undefined;
  lossPct: number | undefined;
  isReconnecting: boolean;
}): HealthState {
  if (args.isReconnecting) return 'stuck';
  if (args.quality === ConnectionQuality.Lost) return 'stuck';
  if (
    args.quality === ConnectionQuality.Poor ||
    (args.lossPct !== undefined && args.lossPct > 5) ||
    (args.rttMs !== undefined && args.rttMs > 300)
  ) {
    return 'failing';
  }
  if (
    (args.lossPct !== undefined && args.lossPct > 2) ||
    (args.rttMs !== undefined && args.rttMs > 200)
  ) {
    return 'degraded';
  }
  // Treat undefined quality as healthy until we have evidence otherwise —
  // avoids painting everyone amber for the first second after they join.
  return 'healthy';
}

export interface UseConnectionHealthOptions {
  /** Set false to skip getStats sampling (e.g. in tests). */
  sampleStats?: boolean;
}

export interface ConnectionHealthSnapshot {
  byIdentity: Map<string, ParticipantHealth>;
  /** Counts grouped by state — drives the condensed pill. */
  counts: Record<HealthState, number>;
  /** Worst state currently present (defaults to 'healthy' on empty rooms). */
  worst: HealthState;
}

const STATE_ORDER: HealthState[] = ['healthy', 'degraded', 'failing', 'stuck'];

export function useConnectionHealth(opts: UseConnectionHealthOptions = {}): ConnectionHealthSnapshot {
  const { sampleStats = true } = opts;
  const participants = useParticipants();
  const room = useRoomContext();

  // identity → counters that persist across renders
  const reconnectCountsRef = useRef<Map<string, number>>(new Map());
  const reconnectingRef = useRef<Set<string>>(new Set());
  const [statsByIdentity, setStatsByIdentity] = useState<Map<string, RawStats>>(new Map());
  // Bumped whenever a reconnect event fires so the snapshot recomputes.
  const [tick, setTick] = useState(0);

  // Subscribe to reconnect lifecycle. LiveKit emits Reconnecting/Reconnected
  // on the Room itself (the local participant's view); for remote participants
  // we observe ConnectionQuality flipping to Lost. Both feed the same map.
  useEffect(() => {
    if (!room) return;
    const onReconnecting = () => {
      // Local-side: attribute to "me" via a sentinel key the consumer ignores;
      // the per-remote signal is ConnectionQuality.Lost, handled in the render
      // pass below.
      setTick((t) => t + 1);
    };
    const onReconnected = () => setTick((t) => t + 1);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    return () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [room]);

  // Track reconnect *count* per remote identity via quality transitions.
  // When a remote flips into Lost we bump the counter once; we clear the
  // reconnecting flag when they recover to Good/Excellent.
  useEffect(() => {
    const reconnectingNow = reconnectingRef.current;
    for (const p of participants) {
      if (p.isLocal) continue;
      const id = p.identity;
      const q = p.connectionQuality;
      if (q === ConnectionQuality.Lost && !reconnectingNow.has(id)) {
        reconnectingNow.add(id);
        const map = reconnectCountsRef.current;
        map.set(id, (map.get(id) ?? 0) + 1);
      } else if (
        (q === ConnectionQuality.Good || q === ConnectionQuality.Excellent) &&
        reconnectingNow.has(id)
      ) {
        reconnectingNow.delete(id);
      }
    }
  }, [participants, tick]);

  // Periodic stats sampling. Cheap (~few ms per participant) — we run it on
  // a single timer for the whole room rather than per-pane to keep work
  // bounded as the room scales.
  useEffect(() => {
    if (!sampleStats) return;
    let cancelled = false;

    const sampleAll = async () => {
      const next = new Map<string, RawStats>();
      const remotes = participants.filter((p) => !p.isLocal) as RemoteParticipant[];
      await Promise.all(
        remotes.map(async (p) => {
          const s = await sampleParticipantStats(p);
          next.set(p.identity, s);
        }),
      );
      if (!cancelled) setStatsByIdentity(next);
    };

    void sampleAll();
    const handle = window.setInterval(() => void sampleAll(), SAMPLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [participants, sampleStats]);

  return useMemo<ConnectionHealthSnapshot>(() => {
    const byIdentity = new Map<string, ParticipantHealth>();
    const counts: Record<HealthState, number> = { healthy: 0, degraded: 0, failing: 0, stuck: 0 };

    for (const p of participants) {
      if (p.isLocal) continue;
      const id = p.identity;
      const stats = statsByIdentity.get(id) ?? {};
      const isReconnecting = reconnectingRef.current.has(id);
      const state = classify({
        quality: p.connectionQuality,
        rttMs: stats.rttMs,
        lossPct: stats.lossPct,
        isReconnecting,
      });
      counts[state] += 1;
      byIdentity.set(id, {
        identity: id,
        name: p.name || p.identity,
        state,
        quality: p.connectionQuality,
        rttMs: stats.rttMs,
        lossPct: stats.lossPct,
        reconnectCount: reconnectCountsRef.current.get(id) ?? 0,
        isReconnecting,
      });
    }

    let worst: HealthState = 'healthy';
    for (const s of STATE_ORDER) if (counts[s] > 0) worst = s;
    return { byIdentity, counts, worst };
  }, [participants, statsByIdentity, tick]);
}
