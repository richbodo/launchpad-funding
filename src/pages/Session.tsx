import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { DollarSign, ExternalLink, LogOut, PhoneOff, Play, Pause, ChevronLeft, ChevronRight, Monitor } from 'lucide-react';
import DemoModeBanner from '@/components/DemoModeBanner';

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
  const { user, logout } = useSessionUser();
  const [totalFunded, setTotalFunded] = useState(0);
  const [startupFunded, setStartupFunded] = useState(0);
  const [startups, setStartups] = useState<Startup[]>([]);
  const [facilitators, setFacilitators] = useState<Facilitator[]>([]);
  const [investOpen, setInvestOpen] = useState(false);
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
        setTotalFunded(investData.reduce((sum, i) => sum + Number(i.amount), 0));
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
        setTotalFunded(prev => prev + Number(inv.amount));
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

    return () => {
      supabase.removeChannel(investChannel);
      supabase.removeChannel(sessionChannel);
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

  // Clear facilitator from stage when a startup takes over
  useEffect(() => {
    if (currentStage?.type === 'presentation' || currentStage?.type === 'qa') {
      setStageIdentity(null);
    }
  }, [currentStage?.type]);

  const currentStartup = activeStartupIndex !== undefined ? startups[activeStartupIndex] : undefined;
  const currentStartupName = currentStartup?.display_name || currentStartup?.email || 'Startup';

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
        {/* Left pane: Facilitator video(s) — up to 3 */}
        <div className="md:w-72 lg:w-80 shrink-0 p-3 border-b md:border-b-0 md:border-r border-border flex flex-col gap-2">
          {facilitators.length > 0 ? (
            facilitators.slice(0, 3).map((f) => {
              const isIntroOutro = currentStage?.type === 'intro' || currentStage?.type === 'outro';
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
                  {isFacilitator && isConnected && isIntroOutro && (
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
        </div>

        {/* Center pane: Startup presentation */}
        <div className="flex-1 flex flex-col p-3 min-w-0">
          <div className="flex-1 rounded-lg overflow-hidden" data-testid="main-video-pane">
            {(() => {
              // The stage (center pane): startup video during presentation/Q&A,
              // facilitator video during intro/outro if someone has taken the stage.
              const isStartupStage = activeStartupIndex !== undefined;
              const stageFacilitator = !isStartupStage && stageIdentity
                ? facilitators.find(f => f.email === stageIdentity)
                : undefined;

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

              if (stageFacilitator) {
                return (
                  <VideoPane
                    label={stageFacilitator.display_name || stageFacilitator.email}
                    sublabel="On Stage"
                    isActive
                    participantIdentity={isConnected ? stageFacilitator.email : undefined}
                    callState={isConnected ? callState : 'idle'}
                  />
                );
              }

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
        totalFunded={totalFunded}
        currentStartup={currentStartupName}
        startupFunded={startupFunded}
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
    </div>
  );
}
