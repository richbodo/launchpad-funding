import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { useSessionStages } from '@/hooks/useSessionStages';
import { useLiveKitToken } from '@/hooks/useLiveKitToken';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DollarSign, ExternalLink, Loader2, LogOut, PhoneOff, Play, Pause, ChevronLeft, ChevronRight, Monitor, Video, Settings } from 'lucide-react';
import DemoModeBanner from '@/components/DemoModeBanner';
import { toast } from 'sonner';

interface Startup {
  email: string;
  display_name: string | null;
  presentation_order: number | null;
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
  const [startups, setStartups] = useState<Startup[]>([]);
  const [facilitators, setFacilitators] = useState<Facilitator[]>([]);
  const [investOpen, setInvestOpen] = useState(false);
  const [editStartupOpen, setEditStartupOpen] = useState(false);
  const editAutoOpened = useRef(false);
  const [session, setSession] = useState<any>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [stageIdentity, setStageIdentity] = useState<string | null>(null);

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

    const fetchData = async () => {
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();
      setSession(sessionData);

      const { data: startupData } = await supabase
        .from('session_participants')
        .select('email, display_name, presentation_order')
        .eq('session_id', id)
        .eq('role', 'startup')
        .order('presentation_order', { ascending: true });
      if (startupData) setStartups(startupData);

      const { data: facilitatorData } = await supabase
        .from('session_participants')
        .select('email, display_name')
        .eq('session_id', id)
        .eq('role', 'facilitator');
      if (facilitatorData) setFacilitators(facilitatorData);

      const { data: investData } = await supabase
        .from('investments')
        .select('amount, startup_email')
        .eq('session_id', id);
      if (investData) {
        const byStartup: Record<string, number> = {};
        for (const inv of investData) {
          byStartup[inv.startup_email] = (byStartup[inv.startup_email] || 0) + Number(inv.amount);
        }
        setFundingByStartup(byStartup);
      }
    };
    fetchData();

    // Realtime: investments
    const investChannel = supabase
      .channel(`investments-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'investments',
        filter: `session_id=eq.${id}`,
      }, (payload) => {
        const inv = payload.new as any;
        setFundingByStartup(prev => ({
          ...prev,
          [inv.startup_email]: (prev[inv.startup_email] || 0) + Number(inv.amount),
        }));
      })
      .subscribe();

    // Realtime: session status changes
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

    // Realtime: participant updates (funding_goal, dd_room_link, website_link changes)
    const participantChannel = supabase
      .channel(`participants-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'session_participants',
        filter: `session_id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as any;
        if (updated.role === 'startup') {
          setStartups(prev => prev.map(s =>
            s.email === updated.email
              ? { ...s, funding_goal: updated.funding_goal != null ? Number(updated.funding_goal) : null }
              : s
          ));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(investChannel);
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(participantChannel);
    };
  }, [id, user, navigate]);

  // Facilitator: Start Call (also sets session to 'live')
  const handleStartCall = useCallback(async () => {
    if (!id) return;
    setCallState('connecting');
    if (session?.status !== 'live') {
      await supabase.from('sessions').update({ status: 'live' }).eq('id', id);
    }
    await fetchToken();
    setCallState('connected');
  }, [id, session?.status, fetchToken]);

  // Startup: Join Call
  const handleJoinCall = useCallback(async () => {
    setCallState('connecting');
    await fetchToken();
    setCallState('connected');
  }, [fetchToken]);

  // Facilitator: End Call
  const handleEndCall = useCallback(async () => {
    if (!id) return;
    await supabase.from('sessions').update({ status: 'completed' }).eq('id', id);
    reset();
    setCallState('idle');
  }, [id, reset]);

  // Investor: auto-join as viewer when session goes live
  useEffect(() => {
    if (user?.role === 'investor' && session?.status === 'live' && callState === 'idle') {
      setCallState('connecting');
      fetchToken().then(() => setCallState('connected'));
    }
  }, [session?.status, user?.role, callState, fetchToken]);

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
        // Late joiner: read facilitator's tracked state on first sync
        if (!isFac && !hasInitialSync.current) {
          const state = channel.presenceState();
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
        if (status === 'SUBSCRIBED' && isFac) {
          await channel.track({
            currentStageIndex, isPaused, remainingSeconds, stageIdentity,
          });
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

  // Auto-open edit dialog for startups: on ?edit=true URL param, or if funding_goal not set
  useEffect(() => {
    if (user?.role !== 'startup' || editAutoOpened.current || startups.length === 0) return;
    const myRecord = startups.find(s => s.email === user.email);
    if (searchParams.get('edit') === 'true') {
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
      await supabase
        .from('session_participants')
        .update({ is_logged_in: false })
        .eq('session_id', id)
        .eq('email', user.email);

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
        <div className="md:w-72 lg:w-80 shrink-0 p-3 border-b md:border-b-0 md:border-r border-border flex flex-col gap-2 overflow-y-auto">
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
                    <Button
                      data-testid={`take-stage-btn-${f.email}`}
                      variant={isOnStage ? 'secondary' : 'outline'}
                      size="sm"
                      className="mt-1 w-full"
                      onClick={() => setStageIdentity(f.email)}
                      disabled={isOnStage}
                    >
                      <Monitor className="w-4 h-4 mr-1" />
                      {isOnStage ? 'On Stage' : 'Take Stage'}
                    </Button>
                  )}
                </div>
              );
            })
          ) : (
            <div className="flex-1">
              <VideoPane label="Facilitator" sublabel="Host Stream" />
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
                    <Button
                      data-testid={`take-stage-btn-${s.email}`}
                      variant={isOnStage ? 'secondary' : 'outline'}
                      size="sm"
                      className="mt-1 w-full"
                      onClick={() => setStageIdentity(s.email)}
                      disabled={isOnStage}
                    >
                      <Monitor className="w-4 h-4 mr-1" />
                      {isOnStage ? 'On Stage' : 'Take Stage'}
                    </Button>
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
            <div className="flex items-center justify-center gap-3 mt-3">
              <Button
                data-testid="invest-btn"
                onClick={() => setInvestOpen(true)}
                disabled={currentStage?.type === 'intro' || currentStage?.type === 'outro'}
                className="bg-accent text-accent-foreground hover:bg-accent/90 font-semibold px-6 disabled:opacity-40"
              >
                <DollarSign className="w-4 h-4 mr-1" />
                Invest
              </Button>
              <Button variant="outline" size="sm">
                <ExternalLink className="w-4 h-4 mr-1" />
                DD Room
              </Button>
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
        />
      )}
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
          {/* End Call — next to timer, facilitator only */}
          {isFacilitator && callState === 'connected' && (
            <Button data-testid="end-call-btn" variant="destructive" size="sm" onClick={handleEndCall}>
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
          onDisconnected={() => { reset(); setCallState('idle'); }}
          onError={(err) => console.error('LiveKit error:', err)}
        >
          {sessionContent}
          <RoomAudioRenderer />
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

// ── Startup metadata editing dialog ──────────────────────────────────

interface StartupEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  email: string;
  onSaved: (updates: { dd_room_link?: string | null; website_link?: string | null }) => void;
}

function StartupEditDialog({ open, onOpenChange, sessionId, email, onSaved }: StartupEditDialogProps) {
  const [ddRoomLink, setDdRoomLink] = useState('');
  const [websiteLink, setWebsiteLink] = useState('');
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!open) { loaded.current = false; return; }
    if (loaded.current) return;
    loaded.current = true;

    supabase
      .from('session_participants')
      .select('dd_room_link, website_link')
      .eq('session_id', sessionId)
      .eq('email', email)
      .single()
      .then(({ data }) => {
        if (data) {
          setDdRoomLink(data.dd_room_link || '');
          setWebsiteLink(data.website_link || '');
        }
      });
  }, [open, sessionId, email]);

  const handleSave = async () => {
    setSaving(true);
    const updates: any = {
      dd_room_link: ddRoomLink || null,
      website_link: websiteLink || null,
    };
    const { error } = await supabase
      .from('session_participants')
      .update(updates)
      .eq('session_id', sessionId)
      .eq('email', email);

    setSaving(false);
    if (error) {
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
