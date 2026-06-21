import { useEffect, useState } from 'react';
import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Video, VideoOff, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type CallState = 'idle' | 'connecting' | 'connected';

interface VideoPaneProps {
  label: string;
  sublabel?: string;
  isActive?: boolean;
  participantIdentity?: string;
  callState?: CallState;
  isSelf?: boolean;
  selfRole?: 'facilitator' | 'startup' | 'investor';
  sessionStatus?: string;
  onStartCall?: () => void;
  onJoinCall?: () => void;
}

export default function VideoPane({
  label,
  sublabel,
  isActive = false,
  participantIdentity,
  callState = 'idle',
  isSelf = false,
  selfRole,
  sessionStatus,
  onStartCall,
  onJoinCall,
}: VideoPaneProps) {
  if (!participantIdentity) {
    return (
      <Placeholder
        label={label}
        sublabel={sublabel}
        isActive={isActive}
        callState={callState}
        isSelf={isSelf}
        selfRole={selfRole}
        sessionStatus={sessionStatus}
        onStartCall={onStartCall}
        onJoinCall={onJoinCall}
      />
    );
  }

  return (
    <LiveVideoPane
      label={label}
      sublabel={sublabel}
      isActive={isActive}
      participantIdentity={participantIdentity}
    />
  );
}

function LiveVideoPane({
  label,
  sublabel,
  isActive,
  participantIdentity,
}: {
  label: string;
  sublabel?: string;
  isActive: boolean;
  participantIdentity: string;
}) {
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);

  // Prefer screen share track over camera for the matched participant
  const screenTrack = tracks.find(
    (t) => t.participant.identity === participantIdentity && t.source === Track.Source.ScreenShare,
  );
  const cameraTrack = tracks.find(
    (t) => t.participant.identity === participantIdentity && t.source === Track.Source.Camera,
  );
  const trackRef = screenTrack || cameraTrack;
  const isScreenShare = !!screenTrack;

  // Issue #33: some participants saw "Joining…" for minutes because the remote
  // track never arrived. Once we've waited >12s with no track for an expected
  // identity, surface a manual reload escape hatch — leave/rejoin (a reload)
  // was the only workaround users found in the trial.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (trackRef) {
      setStale(false);
      return;
    }
    const t = setTimeout(() => setStale(true), 12_000);
    return () => clearTimeout(t);
  }, [trackRef]);

  if (!trackRef) {
    return (
      <Placeholder
        label={label}
        sublabel={sublabel}
        isActive={isActive}
        callState="connecting"
        isSelf={false}
        stale={stale}
      />
    );
  }


  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden border border-border">
      <VideoTrack
        trackRef={trackRef}
        style={{ width: '100%', height: '100%', objectFit: isScreenShare ? 'contain' : 'cover' }}
      />

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
        <p className="font-semibold text-white text-sm">{label}</p>
        {sublabel && <p className="text-[11px] text-white/70">{sublabel}</p>}
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        {isScreenShare && (
          <>
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[10px] uppercase tracking-wider text-white font-medium mr-2">Presenting</span>
          </>
        )}
        {isActive && (
          <>
            <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-[10px] uppercase tracking-wider text-white font-medium">Live</span>
          </>
        )}
      </div>
    </div>
  );
}

interface PlaceholderProps {
  label: string;
  sublabel?: string;
  isActive: boolean;
  callState?: CallState;
  isSelf?: boolean;
  selfRole?: 'facilitator' | 'startup' | 'investor';
  sessionStatus?: string;
  onStartCall?: () => void;
  onJoinCall?: () => void;
  /** True once a remote track has failed to arrive within the watchdog window. */
  stale?: boolean;
}

function Placeholder({
  label,
  sublabel,
  isActive,
  callState = 'idle',
  isSelf = false,
  selfRole,
  sessionStatus,
  onStartCall,
  onJoinCall,
  stale = false,
}: PlaceholderProps) {
  const isLive = sessionStatus === 'live';

  const renderAction = () => {
    // Connecting state — spinner for everyone
    if (callState === 'connecting') {
      return (
        <>
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Loader2 className="w-7 h-7 text-muted-foreground animate-spin" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {isSelf && selfRole === 'facilitator' ? 'Starting...' : 'Joining...'}
          </p>
          {stale && (
            <div className="mt-3 flex flex-col items-center gap-1">
              <p className="text-[11px] text-amber-500">Taking longer than usual…</p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Refresh
              </Button>
            </div>
          )}
        </>
      );
    }


    // Self pane — show action buttons
    if (isSelf && selfRole === 'facilitator') {
      return (
        <>
          <Button
            onClick={isLive ? onJoinCall : onStartCall}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Video className="w-4 h-4 mr-2" />
            {isLive ? 'Join Call' : 'Start Call'}
          </Button>
        </>
      );
    }

    if (isSelf && selfRole === 'startup') {
      return (
        <>
          <Button
            onClick={onJoinCall}
            disabled={!isLive}
            className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-40"
          >
            <Video className="w-4 h-4 mr-2" />
            {isLive ? 'Join Call' : 'Waiting for host...'}
          </Button>
        </>
      );
    }

    // Other participants' panes or default — show icon
    return (
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
        {isLive ? (
          <Video className="w-7 h-7 text-muted-foreground animate-pulse" />
        ) : (
          <VideoOff className="w-7 h-7 text-muted-foreground" />
        )}
      </div>
    );
  };

  return (
    <div className="relative w-full h-full bg-primary/5 rounded-lg overflow-hidden flex items-center justify-center border border-border">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/5" />

      <div className="relative z-10 text-center">
        {renderAction()}
        <p className="font-semibold text-foreground mt-2">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
      </div>

      {isActive && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Live</span>
        </div>
      )}
    </div>
  );
}
