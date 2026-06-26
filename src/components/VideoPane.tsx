import { useEffect, useState } from 'react';
import { useTracks, VideoTrack, useParticipants } from '@livekit/components-react';
import { Track, ConnectionQuality } from 'livekit-client';
import { Video, VideoOff, Loader2, RefreshCw, UserX } from 'lucide-react';
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
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false });
  const participants = useParticipants();

  // Is this identity actually present in the LiveKit room right now?
  // Distinguishes "remote participant exists but has no track yet" (real
  // stuck-subscription case → watchdog) from "remote participant has not
  // joined the call yet" (waiting on a human action → no watchdog, no
  // misleading Refresh button).
  const isInRoom = participants.some((p) => p.identity === participantIdentity);

  useEffect(() => {
    const expectedPublications = tracks.filter(
      (t) => t.participant.identity === participantIdentity && t.publication && !t.publication.track,
    );

    expectedPublications.forEach((t) => {
      // TrackPublication is typed as the shared base class, but remote
      // publications expose setSubscribed(). Local self-preview publications do
      // not need it, so guard with a capability check.
      const publication = t.publication as typeof t.publication & { setSubscribed?: (subscribed: boolean) => void };
      publication.setSubscribed?.(true);
    });
  }, [tracks, participantIdentity]);

  // Prefer screen share track over camera for the matched participant
  const screenTrack = tracks.find(
    (t) => t.participant.identity === participantIdentity && t.source === Track.Source.ScreenShare && t.publication.track,
  );
  const cameraTrack = tracks.find(
    (t) => t.participant.identity === participantIdentity && t.source === Track.Source.Camera && t.publication.track,
  );
  const trackRef = screenTrack || cameraTrack;
  const isScreenShare = !!screenTrack;

  // Issue #33 / Test 4 follow-up: only arm the "Taking longer than usual…"
  // watchdog when the participant is genuinely in the room and we're still
  // waiting on a track. If they haven't joined yet, we render a calm
  // "Hasn't joined yet" state instead — no spinner, no Refresh loop.
  const [stale, setStale] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    if (trackRef || !isInRoom) {
      setStale(false);
      return;
    }
    const t = setTimeout(() => setStale(true), 12_000);
    return () => clearTimeout(t);
  }, [trackRef, isInRoom, retryNonce]);

  const softRetry = () => {
    // Toggle subscription off then back on for this participant's publications.
    // Prompts LiveKit to re-negotiate the track without dropping the room
    // connection or affecting any other participant's pane.
    const pubs = tracks.filter((t) => t.participant.identity === participantIdentity);
    pubs.forEach((t) => {
      const publication = t.publication as typeof t.publication & { setSubscribed?: (subscribed: boolean) => void };
      try { publication.setSubscribed?.(false); } catch { /* noop */ }
    });
    setTimeout(() => {
      pubs.forEach((t) => {
        const publication = t.publication as typeof t.publication & { setSubscribed?: (subscribed: boolean) => void };
        try { publication.setSubscribed?.(true); } catch { /* noop */ }
      });
    }, 250);
    setStale(false);
    setRetryNonce((n) => n + 1);
  };

  if (!trackRef) {
    return (
      <Placeholder
        label={label}
        sublabel={sublabel}
        isActive={isActive}
        callState={isInRoom ? 'connecting' : 'idle'}
        isSelf={false}
        notJoined={!isInRoom}
        stale={stale}
        onRetry={softRetry}
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
  /** Optional soft-retry handler invoked from the Refresh button. */
  onRetry?: () => void;
  /** True when the remote participant exists in the session but hasn't joined the LiveKit room yet. */
  notJoined?: boolean;
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
  onRetry,
  notJoined = false,
}: PlaceholderProps) {
  const isLive = sessionStatus === 'live';

  const renderAction = () => {
    // Remote participant exists in session but hasn't joined the call yet.
    // Render a calm waiting state — no spinner, no Refresh loop (which would
    // do nothing useful when there are no publications to re-subscribe to).
    if (notJoined && !isSelf) {
      return (
        <>
          <div className="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-3">
            <UserX className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">Hasn't joined yet</p>
        </>
      );
    }

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
                onClick={() => (onRetry ? onRetry() : window.location.reload())}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Refresh
              </Button>
            </div>
          )}
        </>
      );
    }


    // Self pane — show action buttons. When the session is already live and
    // the facilitator hasn't joined yet, pulse the Join Call button so it's
    // impossible to miss (Test 4 feedback: facilitators didn't realise they
    // had to click Join Call when arriving mid-session).
    if (isSelf && selfRole === 'facilitator') {
      const needsAttention = isLive;
      return (
        <>
          <Button
            onClick={isLive ? onJoinCall : onStartCall}
            className={`bg-green-600 hover:bg-green-700 text-white ${
              needsAttention ? 'animate-pulse ring-4 ring-green-400/60 shadow-lg shadow-green-500/40' : ''
            }`}
          >
            <Video className="w-4 h-4 mr-2" />
            {isLive ? 'Join Call' : 'Start Call'}
          </Button>
          {needsAttention && (
            <p className="text-[11px] text-amber-500 mt-2 font-medium">
              Session is live — click to join
            </p>
          )}
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
