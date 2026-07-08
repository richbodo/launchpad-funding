import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { useSessionStages } from '@/hooks/useSessionStages';
import { useLiveKitToken } from '@/hooks/useLiveKitToken';
import { LiveKitRoom, RoomAudioRenderer, StartAudio, useLocalParticipant, useTracks, useRoomContext } from '@livekit/components-react';
import { Track, ScreenSharePresets, DisconnectReason, RoomEvent } from 'livekit-client';
import '@livekit/components-styles';
import FundingMeter from '@/components/FundingMeter';
import ChatPanel from '@/components/ChatPanel';
import VideoPane from '@/components/VideoPane';
import type { CallState } from '@/components/VideoPane';
import ConnectionHealthPanel from '@/components/ConnectionHealthPanel';
import SessionTimer from '@/components/SessionTimer';
import InvestDialog from '@/components/InvestDialog';
import StageSelector from '@/components/StageSelector';
import ImageUploadField from '@/components/ImageUploadField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DollarSign, ExternalLink, Loader2, LogOut, PhoneOff, Play, Pause, ChevronLeft, ChevronRight, Monitor, MonitorOff, Video, Settings, Volume2, VolumeOff, Mic, MicOff, Eye, RotateCcw, Gift } from 'lucide-react';
import DemoModeBanner from '@/components/DemoModeBanner';
import { toast } from 'sonner';
import { externalLinkHandler } from '@/lib/openExternal';
import { getAdminToken } from '@/lib/adminAuth';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/timezone';

/**
 * Update a session row through the admin-action edge function. Direct UPDATEs
 * to public.sessions are revoked for anon/authenticated, so the facilitator's
 * short-lived bearer token (issued at password login) is required. Returns
 * true on success; surfaces a toast and returns false on failure so callers
 * can avoid advancing UI state into an inconsistent "connected" view.
 */
async function adminUpdateSessionStatus(
  id: string,
  status: 'draft' | 'scheduled' | 'live' | 'completed',
): Promise<boolean> {
  const admin_token = getAdminToken();
  if (!admin_token) {
    toast.error('Missing facilitator session — please log in again.');
    return false;
  }
  const { data, error } = await supabase.functions.invoke('admin-action', {
    body: { admin_token, action: 'update_session', payload: { id, status } },
  });
  if (error || data?.error) {
    toast.error(`Failed to set session ${status}: ${data?.error || error?.message || 'unknown error'}`);
    return false;
  }
  return true;
}

interface Startup {
  email: string;
  display_name: string | null;
  presentation_order: number | null;
  funding_goal: number | null;
  dd_room_link: string | null;
  website_link: string | null;
  description: string | null;
}

/**
 * Normalize a user-entered URL so it is safe to put in an `href` and opens in
 * a new tab. Strips whitespace and adds an `https://` scheme when the user
 * typed a bare host like `acme.io`. Returns null for empty/invalid input so
 * callers can disable the link.
 */
function normalizeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Block dangerous schemes (javascript:, data:, etc.)
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // No scheme — assume https
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

interface Facilitator {
  email: string;
  display_name: string | null;
}

/**
 * Read the current session row directly from the database. The waiting-room
 * transition must not depend only on realtime events because a startup can sit
 * on the pre-session overlay before the facilitator joins, miss the UPDATE, and
 * remain locked outside the call even after the session is live.
 */
async function fetchSessionSnapshot(sessionId: string): Promise<any | null> {
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  return data ?? null;
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useSessionUser();
  const [fundingByStartup, setFundingByStartup] = useState<Record<string, number>>({});
  // Track every investment id we've applied so reconnects / dual-source delivery
  // (Broadcast + initial fetch) can never double-count a pledge.
  const seenInvestmentIdsRef = useRef<Set<string>>(new Set());
  const [startups, setStartups] = useState<Startup[]>([]);
  const [facilitators, setFacilitators] = useState<Facilitator[]>([]);
  const [investOpen, setInvestOpen] = useState(false);
  // Issue #41: investors with class === 'accredited' can open the dialog in
  // either 'equity' or 'gift' mode. Community supporters only get 'gift'.
  const [investPledgeType, setInvestPledgeType] = useState<'equity' | 'gift'>('equity');
  const [editStartupOpen, setEditStartupOpen] = useState(false);
  const [editFacilitatorOpen, setEditFacilitatorOpen] = useState(false);
  const editAutoOpened = useRef(false);
  const [session, setSession] = useState<any>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  // When LiveKit disconnects for a non-transient reason (duplicate identity
  // from a second tab, server-side removal, room deleted), we MUST stop the
  // auto-join effect from immediately reconnecting — otherwise two tabs of the
  // same investor kick each other in a tight loop, which visually presents as
  // "the whole page is flashing / chat keeps reloading."
  const autoJoinBlockedRef = useRef(false);
  const [autoJoinBlockedMsg, setAutoJoinBlockedMsg] = useState<string | null>(null);
  const [stageIdentity, setStageIdentity] = useState<string | null>(null);
  const [localMuted, setLocalMuted] = useState(false);
  const [investorCount, setInvestorCount] = useState(0);

  const {
    stages,
    currentStage,
    currentStageIndex,
    isPaused,
    remainingSeconds,
    next,
    prev,
    goToStage,
    togglePause,
    resetStage,
    syncState,
    activeStartupIndex,
  } = useSessionStages(startups);

  const { token, ws_url, fetchToken, reset, error: tokenError } = useLiveKitToken(
    id || '',
    user?.email || '',
    user?.displayName || '',
    user?.role || '',
  );

  // Fetch session data, participants, investments
  useEffect(() => {
    if (!user || !id) {
      navigate('/login');
      return;
    }

    // Reset dedupe set when switching sessions
    seenInvestmentIdsRef.current = new Set();

    // Apply a single investment row (idempotent by id). Issue #41: only
    // equity pledges count toward the startup's funding total — community
    // gift pledges are tracked elsewhere (or simply omitted from the meter).
    const applyInvestment = (inv: { id: string; startup_email: string; amount: number | string; pledge_type?: string | null }) => {
      if (!inv?.id) return;
      if (seenInvestmentIdsRef.current.has(inv.id)) return;
      seenInvestmentIdsRef.current.add(inv.id);
      const ptype = inv.pledge_type ?? 'equity';
      if (ptype !== 'equity') return;
      setFundingByStartup(prev => ({
        ...prev,
        [inv.startup_email]: (prev[inv.startup_email] || 0) + Number(inv.amount),
      }));
    };

    // 1) Subscribe to investments BROADCAST channel BEFORE the initial fetch
    //    so no pledge can fall through the gap.
    const investChannel = supabase
      .channel(`investments:${id}`)
      .on('broadcast', { event: 'INSERT' }, ({ payload }) => {
        applyInvestment(payload as any);
      })
      .subscribe();

    // 2) Subscribe to session status changes (low-volume, keep on postgres_changes)
    const sessionChannel = supabase
      .channel(`session-status-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'sessions',
        filter: `id=eq.${id}`,
      }, (payload) => {
        setSession((prev: any) => ({ ...prev, ...payload.new }));
      })
      .subscribe();

    // Subscribe to participant profile updates via Realtime BROADCAST. A
    // database trigger (broadcast_participant_profile_update_trg) emits one
    // message per *meaningful* change (display_name / presentation_order /
    // funding_goal / dd_room_link / website_link / description / image_url).
    //
    // This replaces the previous postgres_changes subscription, which woke
    // every connected client on every is_logged_in flip — a major contributor
    // to Realtime load during the 0–8s join window of a ~100-user event.
    const participantsChannel = supabase
      .channel(`participants:${id}`)
      .on('broadcast', { event: 'UPDATE' }, ({ payload }) => {
        const updated = payload as any;
        if (!updated?.email) return;
        setStartups(prev => prev.map(s =>
          s.email === updated.email
            ? {
                ...s,
                display_name: updated.display_name ?? s.display_name,
                presentation_order: updated.presentation_order ?? s.presentation_order,
                funding_goal: updated.funding_goal ?? null,
                dd_room_link: updated.dd_room_link ?? null,
                website_link: updated.website_link ?? null,
                description: updated.description ?? null,
              }
            : s
        ));
      })
      .subscribe();


    const fetchData = async () => {
      const sessionData = await fetchSessionSnapshot(id);
      setSession(sessionData);

      let { data: startupData } = await supabase
        .from('session_participants')
        .select('email, display_name, presentation_order, funding_goal, dd_room_link, website_link, description')
        .eq('session_id', id)
        .eq('role', 'startup')
        .order('presentation_order', { ascending: true });
      if (!startupData) {
        const fallback = await supabase
          .from('session_participants')
          .select('email, display_name, presentation_order')
          .eq('session_id', id)
          .eq('role', 'startup')
          .order('presentation_order', { ascending: true });
        startupData = fallback.data?.map(s => ({
          ...s,
          funding_goal: null,
          dd_room_link: null,
          website_link: null,
          description: null,
        })) ?? null;
      }
      if (startupData) setStartups(startupData as Startup[]);

      const { data: facilitatorData } = await supabase
        .from('session_participants')
        .select('email, display_name')
        .eq('session_id', id)
        .eq('role', 'facilitator');
      if (facilitatorData) setFacilitators(facilitatorData);

      // Fetch row-level so we can dedupe by id with the broadcast channel.
      // Goes through a SECURITY DEFINER RPC that gates on caller being a
      // participant — investments are no longer publicly readable.
      const { data: investData } = await supabase.rpc('get_session_investments', {
        _session_id: id,
        _email: user?.email ?? '',
      });
      if (investData) {
        for (const inv of investData) applyInvestment(inv as any);
      }

    };
    fetchData();

    return () => {
      supabase.removeChannel(investChannel);
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(participantsChannel);
    };
  }, [id, user, navigate]);

  // Facilitator: Start Call (also sets session to 'live')
  const handleStartCall = useCallback(async () => {
    if (!id) return;
    setCallState('connecting');
    if (session?.status !== 'live') {
      const ok = await adminUpdateSessionStatus(id, 'live');
      if (!ok) {
        setCallState('idle');
        return;
      }
    }
    await fetchToken();
  }, [id, session?.status, fetchToken]);

  // Startup: Join Call
  const handleJoinCall = useCallback(async () => {
    setCallState('connecting');
    await fetchToken();
  }, [fetchToken]);

  // Facilitator: End Call
  // Marks the session completed AND moves every draft commitment-confirmation
  // email into the facilitator's approval queue. Cancelling the queue later
  // never deletes the underlying investment row — the audit log is preserved.
  const handleEndCall = useCallback(async () => {
    if (!id) return;
    const { error: invErr } = await supabase
      .from('investments')
      .update({ email_status: 'queued', email_queued_at: new Date().toISOString() })
      .eq('session_id', id)
      .eq('email_status', 'draft');
    if (invErr) {
      console.error('Failed to queue commitment emails', invErr);
    }
    const ok = await adminUpdateSessionStatus(id, 'completed');
    if (!ok) return;
    reset();
    setCallState('idle');
    toast.success(
      'Session ended. Investment commitment & thank-you emails have been queued for your approval in the Admin panel.',
      { duration: 12000 },
    );
  }, [id, reset]);

  // Confirmation dialog state for End Call
  const [endCallConfirmOpen, setEndCallConfirmOpen] = useState(false);

  // Auto-join LiveKit room as soon as the session goes live for any non-facilitator.
  // Facilitators connect explicitly via "Start Call" because they control session lifecycle.
  // Startups and investors must never need to click a button to be heard/seen — a missed or
  // race-prone click here was the class of bug where the call appeared to "start for everyone"
  // but in reality only the facilitator was actually publishing/subscribing to the LiveKit room.
  useEffect(() => {
    if (
      user?.role &&
      user.role !== 'facilitator' &&
      session?.status === 'live' &&
      callState === 'idle' &&
      !autoJoinBlockedRef.current
    ) {
      setCallState('connecting');
      fetchToken();
    }
  }, [session?.status, user?.role, callState, fetchToken]);

  // Startup waiting room safety net: keep polling while the overlay is shown so
  // a missed realtime UPDATE cannot strand presenters outside the call. As soon
  // as the facilitator starts the session, `session.status` becomes `live`, the
  // overlay unmounts, and the auto-join effect above fetches the LiveKit token.
  useEffect(() => {
    if (!id || user?.role !== 'startup') return;
    if (session?.status !== 'scheduled' && session?.status !== 'draft') return;

    let cancelled = false;
    const refreshSessionStatus = async () => {
      const latest = await fetchSessionSnapshot(id);
      if (!cancelled && latest) setSession(latest);
    };

    refreshSessionStatus();
    const interval = window.setInterval(refreshSessionStatus, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [id, user?.role, session?.status]);

  // Promote 'connecting' → 'connected' once the LiveKit token actually arrives,
  // and surface fetch errors so silent failures don't strand the UI mid-flow.
  useEffect(() => {
    if (callState === 'connecting' && token && ws_url) {
      setCallState('connected');
    }
  }, [callState, token, ws_url]);

  useEffect(() => {
    if (callState === 'connecting' && tokenError) {
      toast.error(`Video connection failed: ${tokenError}`);
      setCallState('idle');
    }
  }, [callState, tokenError]);

  // Watchdog: if we stay in 'connecting' for too long (slow token fetch, stalled
  // LiveKit negotiation, blocked WS), bail out so the UI doesn't sit on a
  // "Joining…" spinner forever. Issue #33: trial-run participants stayed in
  // "still joining" for minutes; reload was the only fix. Non-facilitators
  // auto-retry once because their join is automatic (no button to press).
  const connectAttemptRef = useRef(0);
  useEffect(() => {
    if (callState !== 'connecting') {
      connectAttemptRef.current = 0;
      return;
    }
    const timer = setTimeout(() => {
      console.warn('[Session] LiveKit connect watchdog fired — resetting');
      reset();
      setCallState('idle');
      const attempt = connectAttemptRef.current + 1;
      connectAttemptRef.current = attempt;
      if (user?.role && user.role !== 'facilitator' && attempt <= 1) {
        toast.message('Reconnecting to video…');
        // The auto-join effect will re-trigger on next render since callState===idle.
      } else {
        toast.error('Video is taking longer than expected. Tap Join again or refresh.');
      }
    }, 20_000);
    return () => clearTimeout(timer);
  }, [callState, reset, user?.role]);


  // Disconnect all non-facilitators when session completes
  useEffect(() => {
    if (session?.status === 'completed' && callState === 'connected') {
      reset();
      setCallState('idle');
    }
  }, [session?.status, callState, reset]);

  // Clear stage override when stage advances (let auto-select take over).
  // Only the facilitator owns stage state — non-facilitators receive
  // `stageIdentity` via the realtime broadcast and must not wipe it locally,
  // or the investor view loses whoever the facilitator just put on stage the
  // moment the stage index ticks.
  useEffect(() => {
    if (user?.role !== 'facilitator') return;
    setStageIdentity(null);
  }, [currentStageIndex, user?.role]);

  // ── Stage sync via Supabase Realtime Broadcast + Presence ───────────
  const stageChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const hasInitialSync = useRef(false);

  const broadcastStage = useCallback((
    index: number, paused: boolean, remaining: number, identity: string | null
  ) => {
    const payload = { currentStageIndex: index, isPaused: paused, remainingSeconds: remaining, stageIdentity: identity };
    stageChannelRef.current?.send({ type: 'broadcast', event: 'stage_state', payload });
    stageChannelRef.current?.track(payload);
  }, []);

  // Keep a live ref to the latest facilitator stage state so the presence
  // `join` handler (registered once at subscribe time) can re-broadcast the
  // CURRENT values, not a stale closure snapshot.
  const stageStateRef = useRef({ currentStageIndex, isPaused, remainingSeconds, stageIdentity });
  useEffect(() => {
    stageStateRef.current = { currentStageIndex, isPaused, remainingSeconds, stageIdentity };
  }, [currentStageIndex, isPaused, remainingSeconds, stageIdentity]);

  // Subscribe to stage broadcast channel with presence for late joiners
  useEffect(() => {
    if (!id) return;

    const isFac = user?.role === 'facilitator';
    const channel = supabase.channel(`stage-sync-${id}`);
    stageChannelRef.current = channel;
    hasInitialSync.current = false;

    channel
      .on('broadcast', { event: 'stage_state' }, ({ payload }) => {
        if (!isFac) {
          syncState(payload.currentStageIndex, payload.isPaused, payload.remainingSeconds);
          setStageIdentity(payload.stageIdentity);
          hasInitialSync.current = true;
        }
      })
      .on('presence', { event: 'join' }, () => {
        // Whenever ANY new presence joins, the facilitator re-broadcasts
        // current stage state so the newcomer syncs within milliseconds
        // (rather than waiting up to 5s for the heartbeat or relying on
        // presence-tracked state which may be slightly stale).
        if (isFac) {
          const s = stageStateRef.current;
          broadcastStage(s.currentStageIndex, s.isPaused, s.remainingSeconds, s.stageIdentity);
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();

        // Count investors currently present (across all tracked presences)
        let investors = 0;
        for (const presences of Object.values(state)) {
          for (const p of presences as any[]) {
            if (p?.role === 'investor') investors++;
          }
        }
        setInvestorCount(investors);

        // Late joiner: read facilitator's tracked state on first sync.
        // Iterate EVERY presence (not just `[0]` of each group) so a non-
        // facilitator presence at index 0 of its group doesn't shadow the
        // facilitator's stage state. Without this, users who join after the
        // facilitator put someone on stage land on a blank/auto-selected
        // center pane until the next broadcast.
        if (!isFac && !hasInitialSync.current) {
          let found: any = null;
          for (const presences of Object.values(state)) {
            for (const p of presences as any[]) {
              if (p?.currentStageIndex !== undefined) {
                found = p;
                break;
              }
            }
            if (found) break;
          }
          if (found) {
            syncState(found.currentStageIndex, found.isPaused, found.remainingSeconds);
            setStageIdentity(found.stageIdentity ?? null);
            hasInitialSync.current = true;
          }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Everyone tracks their presence so investors can be counted.
          // Facilitator additionally tracks stage state for late joiners.
          const s = stageStateRef.current;
          await channel.track(
            isFac
              ? { role: user?.role, email: user?.email, ...s }
              : { role: user?.role, email: user?.email }
          );
        }
      });

    return () => {
      supabase.removeChannel(channel);
      stageChannelRef.current = null;
    };
  }, [id, user?.role, syncState, broadcastStage]);

  // Facilitator: broadcast stage state on discrete changes
  const prevStageRef = useRef({ currentStageIndex, isPaused, stageIdentity });

  useEffect(() => {
    if (user?.role !== 'facilitator') return;
    const prev = prevStageRef.current;
    if (
      prev.currentStageIndex !== currentStageIndex ||
      prev.isPaused !== isPaused ||
      prev.stageIdentity !== stageIdentity
    ) {
      broadcastStage(currentStageIndex, isPaused, remainingSeconds, stageIdentity);
      prevStageRef.current = { currentStageIndex, isPaused, stageIdentity };
    }
  }, [currentStageIndex, isPaused, stageIdentity, remainingSeconds, user?.role, broadcastStage]);

  // Issue #34: heartbeat re-broadcast so late joiners and drifting clients
  // resync the countdown. Without this, the facilitator only broadcasts on
  // discrete state changes (play/pause/next/prev), so the `remainingSeconds`
  // tracked in presence goes stale and clients (e.g. Diraj in the trial run)
  // can fall seconds-to-minutes out of sync.
  useEffect(() => {
    if (user?.role !== 'facilitator' || isPaused) return;
    const interval = setInterval(() => {
      broadcastStage(currentStageIndex, isPaused, remainingSeconds, stageIdentity);
    }, 1500);
    return () => clearInterval(interval);
  }, [user?.role, isPaused, currentStageIndex, remainingSeconds, stageIdentity, broadcastStage]);


  // Auto-open edit dialog for startups: on ?edit=true URL param, or if funding_goal or description not set
  useEffect(() => {
    if (user?.role !== 'startup' || editAutoOpened.current || startups.length === 0) return;
    const myRecord = startups.find(s => s.email === user.email);
    const missingRequired = myRecord && (myRecord.funding_goal == null || !myRecord.description || !myRecord.description.trim());
    if (searchParams.get('edit') === 'true' || missingRequired) {
      setEditStartupOpen(true);
      editAutoOpened.current = true;
      // Clean up the URL param
      if (searchParams.has('edit')) {
        searchParams.delete('edit');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [user?.role, user?.email, startups, searchParams, setSearchParams]);

  const currentStartup = activeStartupIndex !== undefined ? startups[activeStartupIndex] : undefined;
  const currentStartupName = currentStartup?.display_name || currentStartup?.email || '';

  // Funding: per-startup during presentations, session total during intro/outro
  const sessionTotalFunded = Object.values(fundingByStartup).reduce((sum, v) => sum + v, 0);
  const currentStartupFunded = currentStartup
    ? (fundingByStartup[currentStartup.email] || 0)
    : sessionTotalFunded;
  const currentFundingGoal = currentStartup?.funding_goal ?? null;

  const handleLogout = async () => {
    if (user && id) {
      // is_logged_in is cleared inside SessionProvider.logout() via the
      // participant-presence edge function. Direct UPDATE on
      // session_participants is no longer allowed from the browser, and
      // direct INSERT on session_logs is now gated to service_role — the
      // audit entry goes through the SECURITY DEFINER log_session_event RPC
      // which verifies the caller via the participant session token.
      await supabase.rpc('log_session_event', {
        _token: user.token ?? '',
        _event_type: 'logout',
        _event_data: { role: user.role },
      });
    }
    logout();
    navigate('/login');
  };

  if (!user || !id) return null;

  const isFacilitator = user.role === 'facilitator';
  const isConnected = callState === 'connected' && token && ws_url;

  const sessionContent = (
    <>
      {autoJoinBlockedMsg && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/30 text-sm text-destructive flex items-center justify-between gap-3">
          <span>{autoJoinBlockedMsg}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              autoJoinBlockedRef.current = false;
              setAutoJoinBlockedMsg(null);
              setCallState('connecting');
              fetchToken();
            }}
          >
            Reconnect
          </Button>
        </div>
      )}
      {/* Main content: 3-pane layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left pane: Facilitator video(s) + startup previews */}
        {/* Issue #42: force an always-visible scrollbar on desktop so facilitators
            with many startups can see at a glance that the pane scrolls.
            `overflow-y-scroll` reserves the track on every platform; the
            `left-pane-scroll` class re-styles WebKit's normally-hidden
            overlay scrollbar to be permanently visible. */}
        <div className="md:w-72 lg:w-80 shrink-0 p-3 border-b md:border-b-0 md:border-r border-border flex flex-col gap-2 overflow-y-scroll left-pane-scroll [scrollbar-gutter:stable]">

          {facilitators.length > 0 ? (
            facilitators.slice(0, 3).map((f) => {
              const isOnStage = stageIdentity === f.email;

              return (
                <div key={f.email} className="flex-1 min-h-0 flex flex-col" data-testid={`facilitator-pane-${f.email}`}>
                  <div className="flex-1 min-h-0">
                    <VideoPane
                      label={f.display_name || f.email}
                      sublabel="Host Stream"
                      participantIdentity={isConnected ? f.email : undefined}
                      callState={callState}
                      isSelf={f.email === user.email}
                      selfRole={f.email === user.email ? 'facilitator' : undefined}
                      sessionStatus={session?.status}
                      onStartCall={handleStartCall}
                      onJoinCall={handleJoinCall}
                    />
                  </div>
                  {isFacilitator && isConnected && (
                    <div className="flex gap-1 mt-1">
                      <Button
                        data-testid={`take-stage-btn-${f.email}`}
                        variant={isOnStage ? 'secondary' : 'outline'}
                        size="sm"
                        className="flex-1"
                        onClick={() => setStageIdentity(f.email)}
                        disabled={isOnStage}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        {isOnStage ? 'On Stage' : 'Take Stage'}
                      </Button>
                      {f.email === user.email ? (
                        <MicToggleButton
                          currentStageIndex={currentStageIndex}
                          currentStageType={currentStage?.type}
                          userRole={user.role}
                        />
                      ) : (
                        <AdminMuteButton
                          identity={f.email}
                          roomName={`session-${id}`}
                        />
                      )}

                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="flex-1">
              <VideoPane label="Facilitator" sublabel="Host Stream" />
            </div>
          )}

          {/* Startup self-preview — always visible to the logged-in startup so a silent
              LiveKit disconnect is immediately obvious (no video frame = not publishing). */}
          {user.role === 'startup' && (
            <div className="flex flex-col" data-testid={`startup-self-pane-${user.email}`}>
              <div className="pt-2 pb-1 border-t border-border mt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                  Your Camera
                </p>
              </div>
              <div className="h-32">
                <VideoPane
                  label={user.displayName || user.email}
                  sublabel="You"
                  participantIdentity={isConnected ? user.email : undefined}
                  callState={callState}
                  isSelf
                  selfRole="startup"
                  sessionStatus={session?.status}
                  onJoinCall={handleJoinCall}
                />
              </div>
            </div>
          )}

          {/* Startups section — facilitators get Take Stage + mute controls;
              investors get read-only tiles so they can see every presenter in
              the room (not just whoever happens to be on the center stage). */}
          {isConnected && startups.length > 0 && (isFacilitator || user.role === 'investor') && (
            <>
              <div className="pt-2 pb-1 border-t border-border mt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Startups</p>
              </div>
              {startups.map((s) => {
                const isOnStage = stageIdentity === s.email;
                return (
                  <div key={s.email} className="flex flex-col" data-testid={`startup-pane-${s.email}`}>
                    <div className="h-24">
                      <VideoPane
                        label={s.display_name || s.email}
                        sublabel="Startup"
                        participantIdentity={isConnected ? s.email : undefined}
                        callState={callState}
                      />
                    </div>
                    {isFacilitator && (
                      <div className="flex gap-1 mt-1">
                        <Button
                          data-testid={`take-stage-btn-${s.email}`}
                          variant={isOnStage ? 'secondary' : 'outline'}
                          size="sm"
                          className="flex-1"
                          onClick={() => setStageIdentity(s.email)}
                          disabled={isOnStage}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          {isOnStage ? 'On Stage' : 'Take Stage'}
                        </Button>
                        <AdminMuteButton
                          identity={s.email}
                          roomName={`session-${id}`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>


        {/* Center pane: Startup presentation */}
        <div className="flex-1 flex flex-col p-3 min-w-0">
          <div className="flex-1 rounded-lg overflow-hidden" data-testid="main-video-pane">
            {(() => {
              // Priority 1: Explicit "Take Stage" override (facilitator or startup)
              if (stageIdentity && isConnected) {
                const stageParticipant = facilitators.find(f => f.email === stageIdentity)
                  || startups.find(s => s.email === stageIdentity);
                if (stageParticipant) {
                  return (
                    <VideoPane
                      label={stageParticipant.display_name || stageParticipant.email}
                      sublabel="On Stage"
                      isActive
                      participantIdentity={stageIdentity}
                      callState={callState}
                    />
                  );
                }
              }

              // Priority 2: Auto-select from stage definition (presentation/Q&A)
              const isStartupStage = activeStartupIndex !== undefined;
              if (isStartupStage && currentStartup) {
                return (
                  <VideoPane
                    label={currentStartupName}
                    sublabel="Startup Presentation"
                    isActive
                    participantIdentity={isConnected ? currentStartup.email : undefined}
                    callState={callState}
                    isSelf={user.role === 'startup' && currentStartup.email === user.email}
                    selfRole={user.role === 'startup' ? 'startup' : undefined}
                    sessionStatus={session?.status}
                    onJoinCall={handleJoinCall}
                  />
                );
              }

              // Priority 3: Placeholder
              return (
                <VideoPane
                  label={currentStage?.label || 'No Presentation'}
                  callState="idle"
                />
              );
            })()}
          </div>

          {/* Present button — visible to all on-call presenters; clearly
              disabled with an explanation when they're not the on-stage one.
              Issue #37: Diraj couldn't find how to share once on stage. */}
          {isConnected && user.role !== 'investor' && (() => {
            const onStageEmail = stageIdentity || currentStartup?.email;
            const isOnStage = !!onStageEmail && onStageEmail === user.email;
            return (
              <div className="flex justify-center mt-2">
                <ScreenShareButton
                  currentStageIndex={currentStageIndex}
                  isOnStage={isOnStage}
                />
              </div>
            );
          })()}

          {/* Audio controls — below the stage */}
          <div className="flex justify-center gap-2 mt-2">
            {/* Mic toggle — facilitators and startups only, inside LiveKitRoom context */}
            {isConnected && user.role !== 'investor' && (
              <MicToggleButton currentStageIndex={currentStageIndex} currentStageType={currentStage?.type} userRole={user.role} />
            )}
            {/* Personal volume mute — all roles, no LiveKit hooks needed.
                Labeled distinctly from the mic mute (issue #37). */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocalMuted(m => !m)}
              title={localMuted ? 'Unmute call audio for yourself only' : 'Mute call audio for yourself only (others still hear)'}
              data-testid="personal-mute-btn"
            >
              {localMuted ? <VolumeOff className="w-4 h-4 mr-1 text-destructive" /> : <Volume2 className="w-4 h-4 mr-1" />}
              <span className="text-xs">{localMuted ? 'Unmute audio' : 'Mute audio'}</span>
            </Button>
          </div>

          {/* Facilitator controls */}
          {isFacilitator && (
            <div className="flex flex-col items-center gap-2 mt-3">
              <span className="text-sm font-semibold text-foreground" data-testid="stage-label">
                {currentStage?.fullLabel}
              </span>

              <div className="flex items-center gap-2">
                <Button
                  data-testid="stage-prev-btn"
                  variant="outline"
                  size="sm"
                  disabled={currentStageIndex === 0}
                  onClick={prev}
                >
                  <ChevronLeft className="w-4 h-4 mr-0.5" />
                  Previous
                </Button>

                <Button
                  data-testid="stage-playpause-btn"
                  variant={isPaused ? 'default' : 'secondary'}
                  size="sm"
                  onClick={togglePause}
                >
                  {isPaused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
                  {isPaused ? 'Play' : 'Pause'}
                </Button>

                <Button
                  data-testid="stage-next-btn"
                  variant="outline"
                  size="sm"
                  disabled={currentStageIndex === stages.length - 1}
                  onClick={next}
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-0.5" />
                </Button>

                <StageSelector
                  stages={stages}
                  currentStageIndex={currentStageIndex}
                  onSelectStage={goToStage}
                />
              </div>
            </div>
          )}

          {/* Investor actions */}
          {user.role === 'investor' && (
            <div className="flex items-center justify-center flex-wrap gap-3 mt-3">
              {/* Issue #41: equity Invest button only shown to accredited investors.
                  Community supporters see only the Pledge (gift) button below. */}
              {user.investorClass !== 'community' && (
                <Button
                  data-testid="invest-btn"
                  onClick={() => { setInvestPledgeType('equity'); setInvestOpen(true); }}
                  disabled={currentStage?.type === 'intro' || currentStage?.type === 'outro'}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 font-semibold px-6 disabled:opacity-40"
                >
                  <DollarSign className="w-4 h-4 mr-1" />
                  Invest
                </Button>
              )}
              <Button
                data-testid="pledge-btn"
                onClick={() => { setInvestPledgeType('gift'); setInvestOpen(true); }}
                disabled={currentStage?.type === 'intro' || currentStage?.type === 'outro'}
                variant={user.investorClass === 'community' ? 'default' : 'outline'}
                className={user.investorClass === 'community'
                  ? 'bg-accent text-accent-foreground hover:bg-accent/90 font-semibold px-6 disabled:opacity-40'
                  : 'font-semibold px-6 disabled:opacity-40'}
                title="Non-binding gift pledge (max $100)"
              >
                <Gift className="w-4 h-4 mr-1" />
                Pledge a Gift
              </Button>
              {(() => {
                const ddUrl = normalizeExternalUrl(currentStartup?.dd_room_link);
                const siteUrl = normalizeExternalUrl(currentStartup?.website_link);
                return (
                  <>
                    <Button
                      asChild={!!ddUrl}
                      variant="outline"
                      size="sm"
                      disabled={!ddUrl}
                      data-testid="dd-room-btn"
                      title={ddUrl ? `Open DD Room for ${currentStartupName}` : 'No DD Room URL provided'}
                    >
                      {ddUrl ? (
                        <a href={ddUrl} target="_blank" rel="noopener noreferrer" onClick={externalLinkHandler(ddUrl)}>
                          <ExternalLink className="w-4 h-4 mr-1" />
                          DD Room
                        </a>
                      ) : (
                        <span>
                          <ExternalLink className="w-4 h-4 mr-1" />
                          DD Room
                        </span>
                      )}
                    </Button>
                    <Button
                      asChild={!!siteUrl}
                      variant="outline"
                      size="sm"
                      disabled={!siteUrl}
                      data-testid="website-btn"
                      title={siteUrl ? `Open website for ${currentStartupName}` : 'No website URL provided'}
                    >
                      {siteUrl ? (
                        <a href={siteUrl} target="_blank" rel="noopener noreferrer" onClick={externalLinkHandler(siteUrl)}>
                          <ExternalLink className="w-4 h-4 mr-1" />
                          Website
                        </a>
                      ) : (
                        <span>
                          <ExternalLink className="w-4 h-4 mr-1" />
                          Website
                        </span>
                      )}
                    </Button>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Right pane: Chat */}
        <div className="md:w-80 lg:w-96 shrink-0 h-64 md:h-auto">
          <ChatPanel sessionId={id} />
        </div>
      </div>

      {/* Invest dialog */}
      {currentStartup && (
        <InvestDialog
          open={investOpen}
          onOpenChange={setInvestOpen}
          sessionId={id}
          startupName={currentStartup.display_name || currentStartup.email}
          startupEmail={currentStartup.email}
          pledgeType={investPledgeType}
        />
      )}

      {/* End-call confirmation — facilitator only */}
      <AlertDialog open={endCallConfirmOpen} onOpenChange={setEndCallConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End the session for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? This will end the call for <strong>all participants</strong>.
              If you just need to leave, close this tab instead — the session will keep running.
              <br /><br />
              When you confirm, every soft commitment from this session will be queued as a
              confirmation email for your review in the Admin panel. Nothing is sent until you
              approve them there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep session running</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setEndCallConfirmOpen(false); handleEndCall(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              End session for everyone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return (
    <div className="h-screen flex flex-col bg-background">
      <DemoModeBanner />
      <FundingMeter
        startupFunded={currentStartupFunded}
        fundingGoal={currentFundingGoal}
        currentStartup={currentStartupName}
      />

      {/* Session header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-sm">{session?.name || 'Funding Session'}</h2>
          <SessionTimer
            currentPhase={currentStage?.label ?? ''}
            remainingSeconds={remainingSeconds}
            isPaused={isPaused}
          />
          {/* Stage timer controls — facilitator only. Play/Pause toggles
              the countdown; Reset restores the stage's full duration. */}
          {isFacilitator && (
            <div className="flex items-center gap-1">
              <Button
                data-testid="stage-play-pause-btn"
                variant={isPaused ? 'default' : 'secondary'}
                size="sm"
                onClick={togglePause}
                title={isPaused ? 'Start timer' : 'Pause timer'}
              >
                {isPaused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
                {isPaused ? 'Start' : 'Pause'}
              </Button>
              <Button
                data-testid="stage-reset-btn"
                variant="outline"
                size="sm"
                onClick={resetStage}
                title="Reset this stage's timer"
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Reset
              </Button>
            </div>
          )}
          {/* End Call — next to timer, facilitator only */}
          {isFacilitator && callState === 'connected' && (
            <Button data-testid="end-call-btn" variant="destructive" size="sm" onClick={() => setEndCallConfirmOpen(true)}>
              <PhoneOff className="w-4 h-4 mr-1" />
              End Call
            </Button>
          )}
          {/* Join Video Chat — startup only, when session is live */}
          {user.role === 'startup' && session?.status === 'live' && callState === 'idle' && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleJoinCall}>
              <Video className="w-4 h-4 mr-1" />
              Join Video Chat
            </Button>
          )}
          {user.role === 'startup' && callState === 'connecting' && (
            <Button size="sm" disabled>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              Joining...
            </Button>
          )}
          {user.role === 'startup' && (
            <Button
              size="sm"
              className="bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100"
              onClick={() => setEditStartupOpen(true)}
              data-testid="edit-startup-btn"
            >
              <Settings className="w-4 h-4 mr-1" />
              Edit Your Startup Info
            </Button>
          )}
          {user.role === 'facilitator' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditFacilitatorOpen(true)}
              data-testid="edit-facilitator-btn"
            >
              <Settings className="w-4 h-4 mr-1" />
              Edit Your Bio
            </Button>
          )}
          {(user.role === 'startup' || user.role === 'facilitator') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/session/${id}/ready`)}
              data-testid="green-room-link"
              title="Open the Green Room to edit your full profile"
            >
              Green Room
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            data-testid="investor-watching-count"
            title="Investors currently in this session"
          >
            <Eye className="w-3.5 h-3.5 text-blue-400" />
            {investorCount === 1
              ? 'There is 1 Investor watching this session'
              : `There are ${investorCount} Investors watching this session`}
          </span>
          <span className="text-xs text-muted-foreground">{user.displayName} ({user.role})</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* LiveKitRoom only when connected */}
      {isConnected ? (
        <LiveKitRoom
          serverUrl={ws_url}
          token={token}
          connect={true}
          video={user.role !== 'investor'}
          audio={user.role !== 'investor'}
          style={{ display: 'contents' }}
          // Explicit subscribe + adaptive defaults — Issue #33 diagnostics.
          // autoSubscribe ensures remote tracks flow without per-component opt-in,
          // adaptiveStream/dynacast keep bandwidth sane when many tiles render.
          connectOptions={{ autoSubscribe: true }}
          options={{ adaptiveStream: true, dynacast: true }}
          onConnected={() => {
            console.info('[LiveKit] connected');
            // Successful (re)connect clears any prior block — e.g. user
            // closed the duplicate tab and clicked Reconnect.
            autoJoinBlockedRef.current = false;
            setAutoJoinBlockedMsg(null);
          }}
          onDisconnected={(reason?: DisconnectReason) => {
            console.info('[LiveKit] disconnected, reason=', reason);
            reset();
            setCallState('idle');
            // Non-transient disconnects: stop the auto-rejoin loop and tell
            // the user what happened. DUPLICATE_IDENTITY is the canonical
            // "two tabs of the same user" loop that flashes the whole page.
            // CLIENT_INITIATED is excluded — it fires on every intentional
            // disconnect (facilitator ending the call, session row flipping
            // to completed and unmounting <LiveKitRoom>), so treating it as
            // fatal would show a scary "Disconnected — Reconnect" banner at
            // the natural end of every session.
            const isFatal =
              reason === DisconnectReason.DUPLICATE_IDENTITY ||
              reason === DisconnectReason.PARTICIPANT_REMOVED ||
              reason === DisconnectReason.ROOM_DELETED;
            if (isFatal) {
              autoJoinBlockedRef.current = true;
              const msg =
                reason === DisconnectReason.DUPLICATE_IDENTITY
                  ? 'You appear to be joined from another tab or device. Close the other one and click Reconnect.'
                  : reason === DisconnectReason.PARTICIPANT_REMOVED
                    ? 'You were removed from the session.'
                    : 'The session room was closed.';
              setAutoJoinBlockedMsg(msg);
              toast.error(msg, { duration: 12000 });
            }

          }}
          onError={(err) => console.error('[LiveKit] error:', err)}
        >
          {sessionContent}
          <RoomAudioRenderer muted={localMuted} volume={1} />
          {/* Browsers block audio autoplay until a user gesture. We use a
              custom button (instead of <StartAudio/>) so it's loud, full-width
              at the top of the viewport, and reactive to playback-status
              changes that happen *after* a remote audio track is published
              (investors hit this most because they never publish a mic and
              therefore never produce a user gesture during join). */}
          <EnableAudioBanner />
          <StartAudio
            label="🔊 Click to enable audio"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md bg-primary text-primary-foreground shadow-lg hover:opacity-90"
          />
          <ForceLiveKitSubscriptions />
          <RoomEventLogger sessionId={id} actorEmail={user.email} />
          {isFacilitator && (
            <ConnectionHealthPanelMount
              sessionId={id!}
              facilitatorEmail={user.email}
              facilitatorName={user.displayName}
            />
          )}
        </LiveKitRoom>
      ) : (
        sessionContent
      )}

      {/* Startup pre-session waiting screen — replaces the confusing "your
          camera is off" view when the facilitator hasn't started the session
          yet. Disappears the instant session.status flips to 'live'. */}
      {user.role === 'startup' && session && (session.status === 'scheduled' || session.status === 'draft') && (
        <StartupWaitingOverlay
          participantId={user.participantId}
          sessionName={session.name}
          startTime={session.start_time}
          endTime={session.end_time}
          timezone={session.timezone}
        />
      )}



      {/* Startup metadata editing dialog */}
      {user.role === 'startup' && (
        <StartupEditDialog
          open={editStartupOpen}
          onOpenChange={setEditStartupOpen}
          sessionId={id}
          email={user.email}
          onSaved={(updates) => {
            setStartups(prev => prev.map(s =>
              s.email === user.email ? { ...s, ...updates } : s
            ));
          }}
        />
      )}
      {/* Facilitator bio editing dialog */}
      {user.role === 'facilitator' && (
        <FacilitatorEditDialog
          open={editFacilitatorOpen}
          onOpenChange={setEditFacilitatorOpen}
          sessionId={id}
          email={user.email}
        />
      )}
    </div>
  );
}

/**
 * Full-screen overlay shown to startups before the facilitator marks the
 * session 'live'. The previous behavior dumped them straight into the empty
 * video grid with "your camera is off", which caused confusion (Issue: pre-
 * session startup landing was indistinguishable from a broken room).
 *
 * Hides itself as soon as `session.status === 'live'` (handled by the parent's
 * conditional render), so no further action is required from the startup.
 */
function StartupWaitingOverlay({
  participantId,
  sessionName,
  startTime,
  endTime,
  timezone,
}: {
  participantId: string;
  sessionName: string;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
}) {
  const [notifying, setNotifying] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Tick once a second so the cooldown countdown UI re-renders.
  useEffect(() => {
    if (!cooldownUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  const cooldownLeft = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0;
  const disabled = notifying || cooldownLeft > 0;

  const tz = timezone || 'UTC';
  const dateStr = startTime ? formatDateInTimeZone(startTime, tz) : null;
  const startStr = startTime ? formatTimeInTimeZone(startTime, tz, true) : null;
  const endStr = endTime ? formatTimeInTimeZone(endTime, tz, true) : null;

  const handleNotify = async () => {
    setNotifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('notify-facilitators-waiting', {
        body: { participant_id: participantId },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || 'Could not notify facilitators.');
      } else {
        toast.success(
          data?.sent
            ? `Notified ${data.sent} facilitator${data.sent === 1 ? '' : 's'}. They'll start the session shortly.`
            : 'Notification sent.',
        );
        setCooldownUntil(Date.now() + 60_000);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not notify facilitators.');
    } finally {
      setNotifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 backdrop-blur-sm p-6">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl shadow-xl p-8 text-center">
        <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-emerald-600 animate-spin" />
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">
          The session hasn't started yet
        </h1>
        <p className="text-sm text-muted-foreground mb-5">
          Waiting for the facilitators to start <strong>{sessionName}</strong>.
          You'll be brought in automatically the moment they go live.
        </p>

        {dateStr && (
          <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 mb-6 text-left">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Scheduled
            </p>
            <p className="text-sm font-medium text-foreground">{dateStr}</p>
            {startStr && (
              <p className="text-sm text-muted-foreground">
                {startStr}{endStr ? ` – ${endStr}` : ''}
              </p>
            )}
          </div>
        )}

        <Button
          size="lg"
          className="w-full"
          onClick={handleNotify}
          disabled={disabled}
        >
          {notifying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Sending…
            </>
          ) : cooldownLeft > 0 ? (
            `Notified · wait ${cooldownLeft}s`
          ) : (
            'Notify Facilitators I\u2019m Waiting'
          )}
        </Button>
      </div>
    </div>
  );
}



/**
 * Force-subscribe to expected remote media publications as soon as LiveKit
 * announces them. The incident symptom was participants successfully joining
 * and publishing, while other clients stayed on "Joining…" and heard no audio
 * because the remote publications never became subscribed/renderable.
 */
function ForceLiveKitSubscriptions() {
  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare, Track.Source.Microphone],
    { onlySubscribed: false },
  );

  useEffect(() => {
    tracks.forEach((trackRef) => {
      if (trackRef.publication.track) return;
      const publication = trackRef.publication as typeof trackRef.publication & { setSubscribed?: (subscribed: boolean) => void };
      publication.setSubscribed?.(true);
    });
  }, [tracks]);

  return null;
}

/**
 * Full-width top banner that unblocks audio playback whenever the browser is
 * preventing autoplay. Investors are the primary victims of this because they
 * never publish a mic and therefore never produce the user gesture LiveKit's
 * <StartAudio> relies on. We subscribe to RoomEvent.AudioPlaybackStatusChanged
 * so the banner reappears if playback is blocked after the initial join (e.g.
 * when the first remote audio track arrives).
 */
function EnableAudioBanner() {
  const room = useRoomContext();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!room) return;
    const sync = () => setBlocked(!room.canPlaybackAudio);
    sync();
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync);
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, sync);
    };
  }, [room]);

  if (!blocked) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await room.startAudio();
          setBlocked(!room.canPlaybackAudio);
        } catch (err) {
          console.error('[LiveKit] startAudio failed:', err);
        }
      }}
      className="fixed top-0 inset-x-0 z-[100] w-full px-4 py-3 bg-primary text-primary-foreground font-semibold text-center shadow-lg hover:opacity-90"
    >
      🔊 Click anywhere here to enable audio for this call
    </button>
  );
}





// ── Room event logger: writes reconnect lifecycle to session_logs ─────
// Diagnostic instrumentation (Jack's repeated dropouts during Test 4).
// Single-responsibility: subscribe to RoomEvent lifecycle, persist to
// session_logs, surface a small non-scary toast on reconnecting.

function RoomEventLogger({ sessionId, actorEmail }: { sessionId: string; actorEmail: string }) {
  const room = useRoomContext();
  const { user } = useSessionUser();

  useEffect(() => {
    if (!room) return;

    // Route through the token-verified SECURITY DEFINER RPC — direct INSERTs
    // on session_logs are locked to service_role, and the RPC records the
    // actor from the participant session token rather than a client-supplied
    // email (prevents cross-participant log spoofing).
    const log = async (eventType: string, data: Record<string, unknown>) => {
      try {
        await supabase.rpc('log_session_event', {
          _token: user?.token ?? '',
          _event_type: eventType,
          _event_data: data as unknown as never,
        });
      } catch (err) {
        console.warn('[RoomEventLogger] failed to persist', eventType, err);
      }
    };
    // sessionId / actorEmail retained in the closure for backwards call-site
    // compatibility even though the RPC derives them from the token.
    void sessionId; void actorEmail;

    const onReconnecting = () => {
      console.info('[LiveKit] reconnecting');
      toast.message('Reconnecting…', { duration: 3000 });
      void log('livekit_reconnecting', { at: new Date().toISOString() });
    };
    const onReconnected = () => {
      console.info('[LiveKit] reconnected');
      toast.success('Reconnected', { duration: 2000 });
      void log('livekit_reconnected', { at: new Date().toISOString() });
    };
    const onConnStateChanged = (state: unknown) => {
      console.info('[LiveKit] connection state:', state);
    };

    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.ConnectionStateChanged, onConnStateChanged);
    return () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ConnectionStateChanged, onConnStateChanged);
    };
  }, [room, sessionId, actorEmail]);

  return null;
}

// ── Facilitator-only floating Connection Health pill ─────────────────
// Mounted inside <LiveKitRoom> so the underlying hook has access to the
// LiveKit room context. Positioned fixed top-right so it's always one
// glance away — the facilitator is usually focused on the stage video,
// not on a settings panel.

function ConnectionHealthPanelMount({
  sessionId,
  facilitatorEmail,
  facilitatorName,
}: {
  sessionId: string;
  facilitatorEmail: string;
  facilitatorName: string | null;
}) {
  return (
    <div className="fixed top-3 right-3 z-40">
      <ConnectionHealthPanel
        sessionId={sessionId}
        facilitatorEmail={facilitatorEmail}
        facilitatorName={facilitatorName}
      />
    </div>
  );
}




// ── Mic toggle button (must be rendered inside LiveKitRoom) ──────────

function MicToggleButton({ currentStageIndex, currentStageType, userRole }: {
  currentStageIndex: number;
  currentStageType?: string;
  userRole: string;
}) {
  const { localParticipant } = useLocalParticipant();
  const isMicOn = localParticipant.isMicrophoneEnabled;
  const prevStageIndex = useRef(currentStageIndex);

  // Stage etiquette nudge: when entering a startup presentation/Q&A, remind facilitators to mute
  useEffect(() => {
    if (prevStageIndex.current !== currentStageIndex) {
      prevStageIndex.current = currentStageIndex;
      if (
        userRole === 'facilitator' &&
        (currentStageType === 'presentation' || currentStageType === 'qa') &&
        localParticipant.isMicrophoneEnabled
      ) {
        toast.info('A startup is presenting — consider muting your mic', {
          duration: 5000,
        });
      }
    }
  }, [currentStageIndex, currentStageType, userRole, localParticipant]);

  const handleToggle = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicOn);
    } catch {
      // Ignore errors (e.g. permission denied)
    }
  };

  return (
    <Button
      variant={isMicOn ? 'ghost' : 'destructive'}
      size="sm"
      onClick={handleToggle}
      title={isMicOn ? 'Mute your microphone (others won\'t hear you)' : 'Unmute your microphone'}
      data-testid="mic-toggle-btn"
    >
      {isMicOn ? <Mic className="w-4 h-4 mr-1" /> : <MicOff className="w-4 h-4 mr-1" />}
      <span className="text-xs">{isMicOn ? 'Mute me' : 'Unmute me'}</span>
    </Button>
  );
}

// ── Screen share button (must be rendered inside LiveKitRoom) ────────

function ScreenShareButton({ currentStageIndex, isOnStage }: { currentStageIndex: number; isOnStage: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const isSharing = localParticipant.isScreenShareEnabled;
  const stageRef = useRef(currentStageIndex);

  // Auto-stop screen share when stage changes
  useEffect(() => {
    if (stageRef.current !== currentStageIndex) {
      stageRef.current = currentStageIndex;
      if (localParticipant.isScreenShareEnabled) {
        localParticipant.setScreenShareEnabled(false);
      }
    }
  }, [currentStageIndex, localParticipant]);

  const handleToggle = async () => {
    try {
      // Issue #36: pitch decks are mostly static vector slides, so we ask the
      // browser/encoder to prefer DETAIL over motion and publish a high-bitrate
      // 1080p track. Without these overrides LiveKit defaults to a 720p/motion
      // profile that pixelated graphs in the trial run.
      await localParticipant.setScreenShareEnabled(
        !isSharing,
        !isSharing
          ? {
              resolution: ScreenSharePresets.h1080fps15.resolution,
              contentHint: 'detail',
              audio: false,
            }
          : undefined,
        !isSharing
          ? {
              videoEncoding: {
                maxBitrate: 3_000_000, // 3 Mbps — plenty for legible slides
                maxFramerate: 15,
                priority: 'high',
              },
              degradationPreference: 'maintain-resolution',
            }
          : undefined,
      );
    } catch {
      // User cancelled the screen share picker — not an error
    }
  };

  // Issue #37: keep the button visible even when not on stage so the
  // affordance is discoverable, but disable it with an explanatory tooltip.
  const disabled = !isOnStage && !isSharing;

  return (
    <Button
      data-testid="present-btn"
      variant={isSharing ? 'destructive' : 'outline'}
      size="sm"
      onClick={handleToggle}
      disabled={disabled}
      title={
        disabled
          ? 'Screen sharing is available once you\'re on stage'
          : isSharing
            ? 'Stop sharing your screen with everyone'
            : 'Share your screen with everyone in the session'
      }
    >
      {isSharing ? (
        <><MonitorOff className="w-4 h-4 mr-1" /> Stop Presenting</>
      ) : (
        <><Monitor className="w-4 h-4 mr-1" /> Present</>
      )}
    </Button>
  );
}

// ── Admin mute button (facilitator mutes another participant) ────────

function AdminMuteButton({ identity, roomName }: { identity: string; roomName: string }) {
  const tracks = useTracks([Track.Source.Microphone]);
  const micTrack = tracks.find(t => t.participant.identity === identity);
  const isMuted = !micTrack || micTrack.publication?.isMuted;
  const [loading, setLoading] = useState(false);

  const handleAdminMute = async () => {
    if (isMuted) return; // Can't remote-unmute (LiveKit security restriction)
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mute-participant', {
        body: { room_name: roomName, identity, muted: true },
      });
      if (error || !data?.success) {
        toast.error('Failed to mute participant');
      }
    } catch {
      toast.error('Failed to mute participant');
    }
    setLoading(false);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleAdminMute}
      disabled={loading || isMuted}
      title={isMuted ? `Muted (participant must unmute themselves)` : `Mute ${identity}`}
      data-testid={`admin-mute-btn-${identity}`}
      className="px-2"
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isMuted ? (
        <MicOff className="w-4 h-4 text-destructive" />
      ) : (
        <Mic className="w-4 h-4" />
      )}
    </Button>
  );
}

// ── Startup metadata editing dialog ──────────────────────────────────

interface StartupEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  email: string;
  onSaved: (updates: { funding_goal?: number | null; dd_room_link?: string | null; website_link?: string | null; description?: string | null; image_url?: string | null }) => void;
}

export function StartupEditDialog({ open, onOpenChange, sessionId, email, onSaved }: StartupEditDialogProps) {
  const [fundingGoal, setFundingGoal] = useState('');
  const [ddRoomLink, setDdRoomLink] = useState('');
  const [websiteLink, setWebsiteLink] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);

  const [participantId, setParticipantId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { loaded.current = false; return; }
    if (loaded.current) return;
    loaded.current = true;

    supabase
      .from('session_participants')
      .select('id, funding_goal, dd_room_link, website_link, description, image_url')
      .eq('session_id', sessionId)
      .eq('email', email)
      .single()
      .then(({ data }) => {
        if (data) {
          setParticipantId(data.id);
          setFundingGoal(data.funding_goal != null ? String(data.funding_goal) : '');
          setDdRoomLink(data.dd_room_link || '');
          setWebsiteLink(data.website_link || '');
          setDescription((data as any).description || '');
          setImageUrl((data as any).image_url || '');
        }
      });
  }, [open, sessionId, email]);

  const handleSave = async () => {
    if (!participantId) {
      toast.error('Could not identify startup row');
      return;
    }
    // Description is required — keep dialog open until provided.
    if (!description.trim()) {
      toast.error('Please add a short description (about two sentences).');
      return;
    }

    // Normalize user-entered URLs: if they typed "example.com" without a
    // scheme, prepend https:// so zod's .url() validator on the edge
    // function doesn't reject the whole payload (which would otherwise
    // silently drop description + image_url along with it).
    const normalizeUrl = (raw: string): string | null => {
      const v = raw.trim();
      if (!v) return null;
      if (/^https?:\/\//i.test(v)) return v;
      return `https://${v}`;
    };

    setSaving(true);
    const updates: any = {
      funding_goal: fundingGoal ? parseFloat(fundingGoal) : null,
      dd_room_link: normalizeUrl(ddRoomLink),
      website_link: normalizeUrl(websiteLink),
      description: description.trim(),
      image_url: imageUrl || null,
    };
    const { data, error } = await supabase.functions.invoke('startup-update-self', {
      body: { participant_id: participantId, ...updates },
    });

    setSaving(false);
    const errMsg = error?.message || (typeof data?.error === 'string' ? data.error : null) ||
      (data?.error && typeof data.error === 'object' ? JSON.stringify(data.error) : null);
    if (errMsg) {
      toast.error(`Failed to save: ${errMsg}`);
    } else {
      toast.success('Startup info saved');
      onSaved(updates);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Startup Info</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="startup-description">
              Description <span className="text-destructive">*</span>
              <span className="ml-1 text-xs text-muted-foreground">(about two sentences)</span>
            </Label>
            <textarea
              id="startup-description"
              required
              rows={3}
              maxLength={600}
              placeholder="One or two sentences describing what your startup does."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="edit-startup-description"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="funding-goal">Funding Goal ($)</Label>
            <Input
              id="funding-goal"
              type="number"
              placeholder="125000"
              value={fundingGoal}
              onChange={(e) => setFundingGoal(e.target.value)}
              data-testid="edit-funding-goal"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dd-room-link">DD Room Link</Label>
            <Input
              id="dd-room-link"
              type="url"
              placeholder="https://..."
              value={ddRoomLink}
              onChange={(e) => setDdRoomLink(e.target.value)}
              data-testid="edit-dd-room-link"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website-link">Website</Label>
            <Input
              id="website-link"
              type="url"
              placeholder="https://..."
              value={websiteLink}
              onChange={(e) => setWebsiteLink(e.target.value)}
              data-testid="edit-website-link"
            />
          </div>
          {participantId && (
            <ImageUploadField
              label="Logo / Image"
              value={imageUrl}
              onChange={setImageUrl}
              kind="participant"
              refId={participantId}
              participantId={participantId}
              helpText="Shown to investors when you join. PNG/JPG/WebP/GIF, max 5MB."
            />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} data-testid="save-startup-info-btn">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ── Facilitator metadata editing dialog ──────────────────────────────
//
// Lets a logged-in facilitator self-update their bio (≤500 chars, optional)
// without granting anon UPDATE on session_participants. Mirrors
// StartupEditDialog and routes through the `facilitator-update-self` edge
// function for the same RLS-bypass + role-verification pattern.

interface FacilitatorEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  email: string;
}

function FacilitatorEditDialog({ open, onOpenChange, sessionId, email }: FacilitatorEditDialogProps) {
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!open) { loaded.current = false; return; }
    if (loaded.current) return;
    loaded.current = true;
    supabase
      .from('session_participants')
      .select('id, bio')
      .eq('session_id', sessionId)
      .eq('email', email)
      .single()
      .then(({ data }) => {
        if (data) {
          setParticipantId(data.id);
          setBio((data as any).bio || '');
        }
      });
  }, [open, sessionId, email]);

  const handleSave = async () => {
    if (!participantId) {
      toast.error('Could not identify facilitator row');
      return;
    }
    if (bio.length > 500) {
      toast.error('Bio must be 500 characters or fewer.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('facilitator-update-self', {
      body: { participant_id: participantId, bio: bio.trim() || null },
    });
    setSaving(false);
    if (error || data?.error) {
      toast.error('Failed to save bio');
    } else {
      toast.success('Bio saved');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Your Bio</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="facilitator-bio">
            Bio <span className="ml-1 text-xs text-muted-foreground">(optional, up to 500 characters)</span>
          </Label>
          <textarea
            id="facilitator-bio"
            rows={6}
            maxLength={500}
            placeholder="A short bio shown on the public event page."
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 500))}
            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="edit-facilitator-bio"
          />
          <div className="text-right text-xs text-muted-foreground">{bio.length}/500</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} data-testid="save-facilitator-bio-btn">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
