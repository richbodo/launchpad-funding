import { HelpCircle } from 'lucide-react';
import { useDemoMode } from '@/hooks/useDemoMode';

const HELP_URL = 'https://github.com/richbodo/launchpad-funding/blob/main/README.md';

export default function HelpButton() {
  const { isDemoMode } = useDemoMode();

  return (
    <a
      href={HELP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`fixed right-3 z-[60] inline-flex items-center justify-center w-8 h-8 rounded-full bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors backdrop-blur-sm border border-border/50 ${isDemoMode ? 'top-12' : 'top-3'}`}
      title="Help — View README"
    >
      <HelpCircle className="w-4 h-4" />
    </a>
  );
}
