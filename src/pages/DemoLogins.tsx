import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import DemoModeBanner from '@/components/DemoModeBanner';
import { ArrowLeft, Settings, LogIn, ExternalLink } from 'lucide-react';

interface Session {
  id: string;
  name: string;
  status: string;
  start_time: string;
  end_time: string;
  slug: string | null;
  description: string | null;
  hero_image_url: string | null;
}

interface Participant {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  password_hash: string | null;
  session_id: string;
  investor_class: 'accredited' | 'community' | null;
  image_url: string | null;
}

/**
 * Demo-only credential listing.
 *
 * password_hash is no longer readable from the client, so this page now
 * fetches everything from the `demo-logins` edge function. That function
 * returns data only when app_settings.mode === 'demo'.
 *
 * Each participant gets a one-click "Auto-login" button that hands off to
 * /login with magic-link query params (`session`, `email`, `role`). The
 * Login page's auto-login useEffect picks those up and drops the user
 * directly into the session without any password prompt for
 * investors/startups, so demoing each investor class (accredited vs
 * community) is a single click.
 */
export default function DemoLogins() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [demoPassword, setDemoPassword] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const { data, error: fnErr } = await supabase.functions.invoke('demo-logins', { body: {} });
      if (fnErr || data?.error) {
        setError(data?.error || 'Demo mode is not active.');
        setLoading(false);
        return;
      }
      setSessions(data.sessions || []);
      setParticipants(data.participants || []);
      setDemoPassword(data.demo_facilitator_password || '');
      setLoading(false);
    };
    fetchData();
  }, []);

  /**
   * Build the auto-login URL for a specific participant. Mirrors the magic-
   * link parameters Login.tsx recognises in its `doAutoLogin` effect.
   * Facilitators additionally carry the demo password so Login.tsx can
   * perform a real participant-login handshake (no demo-mode auth bypass).
   */
  const autoLoginHref = (sessionId: string, email: string, role: string) => {
    const base = `/login?session=${encodeURIComponent(sessionId)}&email=${encodeURIComponent(email)}&role=${encodeURIComponent(role)}`;
    if (role === 'facilitator' && demoPassword) {
      return `${base}&password=${encodeURIComponent(demoPassword)}`;
    }
    return base;
  };

  const facilitators = participants.filter(p => p.role === 'facilitator');
  // Facilitators are identical across all sessions, but their auto-login URL
  // still needs a session id — we use the first session for the shortcut.
  const facilitatorJumpSessionId = sessions[0]?.id;
  const uniqueFacilitators = Array.from(
    new Map(facilitators.map(f => [f.email, f])).values()
  );

  const statusColor = (s: string) =>
    s === 'live' ? 'bg-accent/10 text-accent' :
    s === 'scheduled' ? 'bg-primary/10 text-primary' :
    'bg-muted text-muted-foreground';

  const investorClassBadge = (cls: Participant['investor_class']) => {
    if (cls === 'accredited') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-funding/10 text-funding font-medium">Accredited</span>;
    if (cls === 'community')  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Community</span>;
    return <span className="text-[10px] text-muted-foreground">—</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <DemoModeBanner />
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <DemoModeBanner />
        <div className="max-w-2xl mx-auto p-6">
          <div className="flex items-center gap-3 mb-6">
            <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Session Login
            </Button>
          </div>
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {error}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DemoModeBanner />
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Session Login
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <Settings className="w-4 h-4 mr-1" /> Admin
          </Button>
        </div>

        <h1 className="text-2xl font-bold mb-2">Demo Shortcuts</h1>
        <p className="text-muted-foreground mb-6">
          Click <span className="font-medium text-foreground">Auto-login</span> next to any participant to jump straight into their session — no password,
          no role picker. Both accredited investors and community supporters are seeded so you can demo either flow with a single click. The
          <span className="font-medium text-foreground"> Randomize</span> buttons on the login page also work for shuffling between participants of a chosen role.
        </p>

        <h2 className="text-2xl font-bold mb-2">Facilitators (all sessions)</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Facilitators manage every session and admin the application. They always need a password (Auto-login skips the role picker but still asks for the password).
        </p>
        <Card className="mb-8">
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Password</TableHead>
                  <TableHead className="text-right">Auto-login</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uniqueFacilitators.map(f => (
                  <TableRow key={f.email}>
                    <TableCell className="font-medium">{f.display_name || f.email}</TableCell>
                    <TableCell className="font-mono text-sm">{f.email}</TableCell>
                    <TableCell className="font-mono text-sm">{f.password_hash || '—'}</TableCell>
                    <TableCell className="text-right">
                      {facilitatorJumpSessionId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(autoLoginHref(facilitatorJumpSessionId, f.email, 'facilitator'))}
                        >
                          <LogIn className="w-3.5 h-3.5 mr-1" /> Jump in
                        </Button>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {sessions.map(session => {
          const sessionParticipants = participants.filter(
            p => p.session_id === session.id && p.role !== 'facilitator'
          );
          const startups  = sessionParticipants.filter(p => p.role === 'startup');
          const investors = sessionParticipants.filter(p => p.role === 'investor');

          return (
            <Card key={session.id} className="mb-6 overflow-hidden">
              {session.hero_image_url && (
                <div
                  className="h-24 bg-cover bg-center"
                  style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.4),rgba(0,0,0,0.55)),url(${session.hero_image_url})` }}
                  aria-hidden
                />
              )}
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  {session.name}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(session.status)}`}>
                    {session.status}
                  </span>
                  {session.slug && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-xs"
                      onClick={() => navigate(`/event/${session.slug}`)}
                    >
                      Landing page <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {new Date(session.start_time).toLocaleString()} — {new Date(session.end_time).toLocaleString()}
                </p>
                {session.description && (
                  <p className="text-sm text-muted-foreground mt-1">{session.description}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {startups.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Startups</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="text-right">Auto-login</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {startups.map(p => (
                          <TableRow key={p.email}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                {p.image_url && (
                                  <img
                                    src={p.image_url}
                                    alt=""
                                    aria-hidden
                                    className="w-6 h-6 rounded object-cover bg-muted"
                                  />
                                )}
                                {p.display_name || p.email}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{p.email}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(autoLoginHref(session.id, p.email, 'startup'))}
                              >
                                <LogIn className="w-3.5 h-3.5 mr-1" /> Jump in
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {investors.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Investors</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Class</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="text-right">Auto-login</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {investors.map(p => (
                          <TableRow key={p.email}>
                            <TableCell className="font-medium">{p.display_name || p.email}</TableCell>
                            <TableCell>{investorClassBadge(p.investor_class)}</TableCell>
                            <TableCell className="font-mono text-sm">{p.email}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(autoLoginHref(session.id, p.email, 'investor'))}
                              >
                                <LogIn className="w-3.5 h-3.5 mr-1" /> Jump in
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
