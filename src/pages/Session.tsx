import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { useSessionStages } from '@/hooks/useSessionStages';
import { useLiveKitToken } from '@/hooks/useLiveKitToken';
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useTracks } from '@livekit/components-react';
import { Track, ScreenSharePresets } from 'livekit-client';
import '@livekit/components-styles';
import FundingMeter from '@/components/FundingMeter';
import ChatPanel from '@/components/ChatPanel';
import VideoPane from '@/components/VideoPane';
import type { CallState } from '@/components/VideoPane';
import SessionTimer from '@/components/SessionTimer';
import InvestDialog from '@/components/InvestDialog';
import StageSelector from '@/components/StageSelector';
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
  const editAutoOpened = useRef(false);
  const [session, setSession] = useState<any>(null);
  const [callState, setCallState] = useState<CallState>('idle');
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

    // Subscribe to participant UPDATEs so that when a startup edits their DD
    // Room URL, website, or funding goal, every other client in the session
    // sees the change within a second. We intentionally only react to UPDATE
    // events (not INSERT/DELETE) and only merge the URL/goal fields so the
    // high-frequency `is_logged_in` flips during login don't cause needless
    // re-renders of the startup list.
    const participantsChannel = supabase
      .channel(`session-participants-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'session_participants',
        filter: `session_id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as any;
        if (!updated || updated.role !== 'startup') return;
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
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();
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
      const { data: investData } = await supabase
        .from('investments')
        .select('id, amount, startup_email, pledge_type')
        .eq('session_id', id);
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
      callState === 'idle'
    ) {
      setCallState('connecting');
      fetchToken();
    }
  }, [session?.status, user?.role, callState, fetchToken]);

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

  // Clear stage override when stage advances (let auto-select take over)
  useEffect(() => {
    setStageIdentity(null);
  }, [currentStageIndex]);

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

        // Late joiner: read facilitator's tracked state on first sync
        if (!isFac && !hasInitialSync.current) {
          for (const presences of Object.values(state)) {
            const p = (presences as any[])?.[0];
            if (p?.currentStageIndex !== undefined) {
              syncState(p.currentStageIndex, p.isPaused, p.remainingSeconds);
              setStageIdentity(p.stageIdentity);
              hasInitialSync.current = true;
              break;
            }
          }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Everyone tracks their presence so investors can be counted.
          // Facilitator additionally tracks stage state for late joiners.
          await channel.track(
            isFac
              ? { role: user?.role, email: user?.email, currentStageIndex, isPaused, remainingSeconds, stageIdentity }
              : { role: user?.role, email: user?.email }
          );
        }
      });

    return () => {
      supabase.removeChannel(channel);
      stageChannelRef.current = null;
    };
  }, [id, user?.role, syncState]);

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
    }, 5000);
    return () => clearInterval(interval);
  }, [user?.role, isPaused, currentStageIndex, remainingSeconds, stageIdentity, broadcastStage]);


  // Auto-open edit dialog for startups: on ?edit=true URL param, or if funding_goal not set
  useEffect(() => {
    if (user?.role !== 'startup' || editAutoOpened.current || startups.length === 0) return;
    const myRecord = startups.find(s => s.email === user.email);
    if (searchParams.get('edit') === 'true' || (myRecord && myRecord.funding_goal == null)) {
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
      // session_participants is no longer allowed from the browser.
      await supabase.from('session_logs').insert({
        session_id: id,
        event_type: 'logout',
        event_data: { email: user.email, role: user.role },
        actor_email: user.email,
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

          {/* Startups section — facilitator can put any startup on the center stage */}
          {isFacilitator && isConnected && startups.length > 0 && (
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
          {/* Reset timer — facilitator only (issue #34) */}
          {isFacilitator && (
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
          onConnected={() => console.info('[LiveKit] connected')}
          onDisconnected={() => {
            console.info('[LiveKit] disconnected');
            reset();
            setCallState('idle');
          }}
          onError={(err) => console.error('[LiveKit] error:', err)}
        >
          {sessionContent}
          <RoomAudioRenderer muted={localMuted} />
        </LiveKitRoom>
      ) : (
        sessionContent
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
  onSaved: (updates: { funding_goal?: number | null; dd_room_link?: string | null; website_link?: string | null }) => void;
}

function StartupEditDialog({ open, onOpenChange, sessionId, email, onSaved }: StartupEditDialogProps) {
  const [fundingGoal, setFundingGoal] = useState('');
  const [ddRoomLink, setDdRoomLink] = useState('');
  const [websiteLink, setWebsiteLink] = useState('');
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);

  const [participantId, setParticipantId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { loaded.current = false; return; }
    if (loaded.current) return;
    loaded.current = true;

    supabase
      .from('session_participants')
      .select('id, funding_goal, dd_room_link, website_link')
      .eq('session_id', sessionId)
      .eq('email', email)
      .single()
      .then(({ data }) => {
        if (data) {
          setParticipantId(data.id);
          setFundingGoal(data.funding_goal != null ? String(data.funding_goal) : '');
          setDdRoomLink(data.dd_room_link || '');
          setWebsiteLink(data.website_link || '');
        }
      });
  }, [open, sessionId, email]);

  const handleSave = async () => {
    if (!participantId) {
      toast.error('Could not identify startup row');
      return;
    }
    setSaving(true);
    const updates: any = {
      funding_goal: fundingGoal ? parseFloat(fundingGoal) : null,
      dd_room_link: ddRoomLink || null,
      website_link: websiteLink || null,
    };
    // Direct UPDATE on session_participants is no longer allowed from the
    // browser (RLS locked to service_role). Go through the edge function,
    // which verifies the target row is role='startup'.
    const { data, error } = await supabase.functions.invoke('startup-update-self', {
      body: { participant_id: participantId, ...updates },
    });

    setSaving(false);
    if (error || data?.error) {
      toast.error('Failed to save startup info');
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
