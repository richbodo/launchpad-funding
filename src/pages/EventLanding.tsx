import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card } from '@/components/ui/card';
import { Loader2, Calendar, ExternalLink, Users, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Public event landing page (issue #44).
 *
 * - Anonymous: anyone with the /event/:slug link can view session details
 *   and self-register as an investor / community supporter.
 * - Data is fetched through the `event-landing` edge function (service role)
 *   so we never expose attendee emails to the public.
 * - Signups go through the `event-signup` edge function which enforces the
 *   per-session cap and the admin's "Mark session full" toggle. No email is
 *   sent until the admin approves the signup in the admin panel and clicks
 *   the existing "Send invitation" button.
 */

interface LandingStartup {
  display_name: string | null;
  image_url: string | null;
  website_link: string | null;
  dd_room_link: string | null;
  funding_goal: number | null;
  description: string | null;
}
interface LandingFacilitator {
  display_name: string | null;
  image_url: string | null;
  bio: string | null;
}
interface LandingPayload {
  session: {
    id: string;
    name: string;
    description: string | null;
    start_time: string;
    end_time: string;
    timezone: string;
    status: string;
    slug: string;
    hero_image_url: string | null;
    max_attendees: number;
    is_full: boolean;
  };
  startups: LandingStartup[];
  facilitators: LandingFacilitator[];
  approved_attendee_count: number;
  accepting_signups: boolean;
}

const fnUrl = (name: string) =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function EventLanding() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<LandingPayload | null>(null);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [investorClass, setInvestorClass] = useState<'accredited' | 'community'>('accredited');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`${fnUrl('event-landing')}?slug=${encodeURIComponent(slug)}`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
    })
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return; }
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as LandingPayload;
        setData(json);
      })
      .catch((e) => {
        console.error('event-landing fetch failed', e);
        toast.error('Could not load this event.');
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || !email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(fnUrl('event-signup'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          slug,
          email: email.trim(),
          display_name: displayName.trim() || null,
          investor_class: investorClass,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error || 'Signup failed');
        return;
      }
      setSubmitted(true);
      if (json.already_registered) {
        toast.success(
          json.approved
            ? "You're already registered for this event. Check your email for the login link."
            : "You're already on the list. The organizer will email your login link once approved.",
        );
      } else {
        toast.success("You're on the list. The organizer will email your login link once they approve.");
      }
    } catch (err) {
      console.error(err);
      toast.error('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Event not found</h1>
          <p className="text-muted-foreground">
            This event link is invalid or the event has been removed.
          </p>
          <Link to="/" className="inline-block mt-4 text-funding underline">Go home</Link>
        </Card>
      </div>
    );
  }

  const { session, startups, facilitators, accepting_signups } = data;
  const startDate = new Date(session.start_time);
  const dateLabel = startDate.toLocaleString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <header
        className="relative border-b border-border overflow-hidden"
        style={
          session.hero_image_url
            ? {
                backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.7)), url(${session.hero_image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        <div className="max-w-3xl mx-auto px-4 py-16 md:py-24">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">{session.name}</h1>
          <div className="mt-4 flex items-center gap-2 text-muted-foreground">
            <Calendar className="w-4 h-4" />
            <span className="text-sm md:text-base">{dateLabel}</span>
          </div>
          {session.description && (
            <p className="mt-6 text-base md:text-lg text-foreground/90 max-w-2xl">{session.description}</p>
          )}

          {/* Signup form pinned right under the hero per issue #44 */}
          <Card className="mt-8 p-5 md:p-6 max-w-xl bg-card/95 backdrop-blur">
            {submitted ? (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <h2 className="font-semibold">You're on the list</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    The organizer will review your request and email you a login link before the event.
                  </p>
                </div>
              </div>
            ) : !accepting_signups ? (
              <div>
                <h2 className="font-semibold">Sorry, the session is full.</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  This event is no longer accepting new attendees.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3" data-testid="event-signup-form">
                <h2 className="font-semibold">Sign up to attend</h2>
                <div>
                  <Label htmlFor="event-email" className="text-xs">Email <span className="text-muted-foreground">(required)</span></Label>
                  <Input
                    id="event-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                  />
                </div>
                <div>
                  <Label htmlFor="event-name" className="text-xs">Name <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="event-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Jane Doe"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <Label className="text-xs">I'm signing up as</Label>
                  <RadioGroup
                    value={investorClass}
                    onValueChange={(v) => setInvestorClass(v as 'accredited' | 'community')}
                    className="mt-1 grid grid-cols-1 gap-2"
                  >
                    <label className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/40">
                      <RadioGroupItem value="accredited" id="cls-acc" className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium">Accredited investor</div>
                        <div className="text-xs text-muted-foreground">Can pledge equity investments and gifts.</div>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/40">
                      <RadioGroupItem value="community" id="cls-com" className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium">Community supporter</div>
                        <div className="text-xs text-muted-foreground">Can pledge gifts up to $100 to startups you like.</div>
                      </div>
                    </label>
                  </RadioGroup>
                </div>
                <Button type="submit" className="w-full" disabled={submitting} data-testid="event-signup-submit">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign up'}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  We'll only email you once the organizer approves your spot.
                </p>
              </form>
            )}
          </Card>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-12">
        {/* Startups */}
        {startups.length > 0 && (
          <section>
            <h2 className="text-xl font-bold mb-4">Presenting startups</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {startups.map((s, i) => (
                <Card key={i} className="p-4 flex gap-3">
                  {s.image_url ? (
                    <img
                      src={s.image_url}
                      alt={s.display_name || 'Startup'}
                      className="w-16 h-16 rounded-md object-cover bg-muted shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-md bg-muted shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{s.display_name || 'Startup'}</h3>
                    {s.funding_goal != null && (
                      <p className="text-xs text-muted-foreground">Goal: ${Number(s.funding_goal).toLocaleString()} (USD)</p>
                    )}
                    {s.description && (
                      <p className="mt-1.5 text-sm text-foreground/85 line-clamp-4">{s.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {s.website_link && (
                        <a
                          href={s.website_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-funding hover:underline"
                        >
                          Website <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {s.dd_room_link && (
                        <a
                          href={s.dd_room_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-funding hover:underline"
                        >
                          DD Room <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Facilitators */}
        {facilitators.length > 0 && (
          <section>
            <h2 className="text-xl font-bold mb-4">Hosts</h2>
            <div className="flex flex-wrap gap-4">
              {facilitators.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  {f.image_url ? (
                    <img
                      src={f.image_url}
                      alt={f.display_name || 'Facilitator'}
                      className="w-10 h-10 rounded-full object-cover bg-muted"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted" aria-hidden />
                  )}
                  <span className="text-sm">{f.display_name || 'Host'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="pt-8 border-t border-border text-xs text-muted-foreground flex items-center gap-2">
          <Users className="w-3 h-3" />
          {data.approved_attendee_count} of {session.max_attendees} seats taken
        </footer>
      </main>
    </div>
  );
}
