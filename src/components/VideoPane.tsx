import { Video, Mic, MicOff, VideoOff } from 'lucide-react';

interface VideoPaneProps {
  label: string;
  sublabel?: string;
  isActive?: boolean;
}

/** Placeholder video pane — will be replaced with actual WebRTC/embed integration */
export default function VideoPane({ label, sublabel, isActive = true }: VideoPaneProps) {
  return (
    <div className="relative w-full h-full bg-primary/5 rounded-lg overflow-hidden flex items-center justify-center border border-border">
      {/* Placeholder gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/5" />
      
      <div className="relative z-10 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
          {isActive ? (
            <Video className="w-7 h-7 text-muted-foreground" />
          ) : (
            <VideoOff className="w-7 h-7 text-muted-foreground" />
          )}
        </div>
        <p className="font-semibold text-foreground">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
      </div>

      {/* Status indicator */}
      {isActive && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Live</span>
        </div>
      )}
    </div>
  );
}
