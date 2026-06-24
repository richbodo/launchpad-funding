import { useState } from 'react';
import { Rss, Copy, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';

/**
 * Small RSS pill that reveals the public events feed URL in a popover with
 * Copy and Open buttons. The feed itself is served by the `events-rss` edge
 * function; we embed the publishable apikey in the URL so feed readers
 * (which can't send custom headers) authenticate against the Supabase
 * functions gateway. The key is the same one shipped in the front-end
 * bundle, so this leaks nothing new.
 */
export default function RssFeedButton({
  className = '',
  variant = 'outline',
}: {
  className?: string;
  variant?: 'outline' | 'secondary' | 'ghost';
}) {
  const [copied, setCopied] = useState(false);

  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const site = typeof window !== 'undefined' ? window.location.origin : '';
  const feedUrl = `${supaUrl}/functions/v1/events-rss?apikey=${encodeURIComponent(apiKey)}&site=${encodeURIComponent(site)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      toast.success('RSS feed URL copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy — select the URL manually.');
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="sm"
          className={`gap-1.5 ${className}`}
          aria-label="Subscribe via RSS"
        >
          <Rss className="w-4 h-4 text-[hsl(24_95%_53%)]" />
          <span>RSS</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-[min(92vw,28rem)]">
        <div className="space-y-2">
          <div className="text-sm font-semibold">Subscribe to future events</div>
          <p className="text-xs text-muted-foreground">
            Add this URL to any RSS reader to get new pitch sessions as they're
            scheduled.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={feedUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 text-xs font-mono px-2 py-1.5 rounded-md border border-border bg-muted/40"
              aria-label="RSS feed URL"
            />
            <Button type="button" size="sm" variant="secondary" onClick={copy} className="gap-1 shrink-0">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <a
            href={feedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-funding hover:underline"
          >
            Open feed <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
