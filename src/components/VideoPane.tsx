import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Video, VideoOff } from 'lucide-react';

interface VideoPaneProps {
  label: string;
  sublabel?: string;
  isActive?: boolean;
  /** LiveKit participant identity to display (email). If omitted, shows placeholder. */
  participantIdentity?: string;
}

export default function VideoPane({ label, sublabel, isActive = false, participantIdentity }: VideoPaneProps) {
  if (!participantIdentity) {
    return <Placeholder label={label} sublabel={sublabel} isActive={isActive} />;
  }

  return <LiveVideoPane label={label} sublabel={sublabel} isActive={isActive} participantIdentity={participantIdentity} />;
}

/** Renders a single participant's camera track from the LiveKit room context. */
function LiveVideoPane({ label, sublabel, isActive, participantIdentity }: Required<Pick<VideoPaneProps, 'label' | 'isActive' | 'participantIdentity'>> & Pick<VideoPaneProps, 'sublabel'>) {
  const tracks = useTracks([Track.Source.Camera]);
  const trackRef = tracks.find(
    (t) => t.participant.identity === participantIdentity,
  );

  if (!trackRef) {
    return <Placeholder label={label} sublabel={sublabel} isActive={isActive} connecting />;
  }

  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden border border-border">
      <VideoTrack
        trackRef={trackRef}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />

      {/* Label overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
        <p className="font-semibold text-white text-sm">{label}</p>
        {sublabel && <p className="text-[11px] text-white/70">{sublabel}</p>}
      </div>

      {/* Live indicator */}
      {isActive && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-[10px] uppercase tracking-wider text-white font-medium">Live</span>
        </div>
      )}
    </div>
  );
}

function Placeholder({ label, sublabel, isActive, connecting }: { label: string; sublabel?: string; isActive: boolean; connecting?: boolean }) {
  return (
    <div className="relative w-full h-full bg-primary/5 rounded-lg overflow-hidden flex items-center justify-center border border-border">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/5" />

      <div className="relative z-10 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
          {connecting ? (
            <Video className="w-7 h-7 text-muted-foreground animate-pulse" />
          ) : (
            <VideoOff className="w-7 h-7 text-muted-foreground" />
          )}
        </div>
        <p className="font-semibold text-foreground">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
        {connecting && <p className="text-xs text-muted-foreground mt-1">Connecting...</p>}
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
