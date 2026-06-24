import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Calendar, Loader2, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSessionUser } from '@/lib/sessionContext';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/timezone';

/**
 * Public home page for anonymous visitors.
 *
 * Shows a list of upcoming events (each linking to its /event/:slug landing
 * page). Visitors who already have an in-memory session (magic-link returnees,
 * etc.) are sent straight to /login so their existing flow is preserved.
 */

interface UpcomingEvent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  status: string;
  hero_image_url: string | null;
}

const fnUrl = (name: string) =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const Index = () => {
  const navigate = useNavigate();
  const { user } = useSessionUser();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<UpcomingEvent[]>([]);

  useEffect(() => {
    if (user) {
      navigate('/login');
      return;
    }
    let cancelled = false;
    fetch(fnUrl('public-upcoming-events'), {
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (!cancelled) setEvents(json.events || []);
      })
      .catch((e) => {
        console.error('public-upcoming-events fetch failed', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user, navigate]);

  if (user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="font-semibold tracking-tight">FundFlow</div>
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Already invited? Sign in →
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Upcoming events</h1>
          <p className="mt-2 text-muted-foreground">
            Live pitch sessions you can join. Pick one to learn more and request a seat.
          </p>
          <div className="mt-4 flex justify-center md:justify-start">
            <RssFeedButton />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <Card className="p-10 text-center">
            <h2 className="text-lg font-semibold">No upcoming events right now</h2>
            <p className="mt-2 text-muted-foreground">
              Check back soon — new sessions are scheduled regularly.
            </p>
            <Link to="/login" className="inline-block mt-6 text-funding underline">
              Already have an invitation? Sign in
            </Link>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {events.map((ev) => {
              const dateLabel = formatDateInTimeZone(ev.start_time, ev.timezone);
              const timeLabel = formatTimeInTimeZone(ev.start_time, ev.timezone, true);
              return (
                <Link
                  key={ev.id}
                  to={`/event/${ev.slug}`}
                  className="group block"
                  data-testid="upcoming-event-card"
                >
                  <Card className="overflow-hidden h-full flex flex-col transition border-border hover:border-foreground/30">
                    <div
                      className="aspect-[16/9] bg-muted relative"
                      style={
                        ev.hero_image_url
                          ? {
                              backgroundImage: `linear-gradient(rgba(0,0,0,0.1), rgba(0,0,0,0.3)), url(${ev.hero_image_url})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }
                          : undefined
                      }
                    >
                      {ev.status === 'live' && (
                        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-red-500/90 text-white text-xs font-semibold px-2.5 py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="p-5 flex-1 flex flex-col">
                      <h2 className="text-xl font-semibold tracking-tight">{ev.name}</h2>
                      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="w-4 h-4" />
                        <span>{dateLabel} · {timeLabel}</span>
                      </div>
                      {ev.description && (
                        <p className="mt-3 text-sm text-muted-foreground line-clamp-3">
                          {ev.description
                            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                            .replace(/\*\*([^*]+)\*\*/g, '$1')
                            .replace(/^\s*[-*]\s+/gm, '• ')}
                        </p>
                      )}
                      <div className="mt-5 pt-4 border-t border-border flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">View event</span>
                        <Button size="sm" variant="secondary" className="gap-1 group-hover:gap-2 transition-all">
                          Open <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
