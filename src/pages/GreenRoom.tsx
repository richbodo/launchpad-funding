/**
 * GreenRoom — pre-session profile & readiness page.
 *
 * Route: `/session/:id/ready`
 *
 * Role-aware landing for startups and facilitators. Startups complete logo,
 * description, funding goal and links; facilitators complete bio and photo.
 * Investors don't need a profile and are redirected straight into the session.
 *
 * The page is reachable both before a session goes live (the default landing
 * for startup/facilitator logins) and during a live session (via the
 * "Green Room" link in the session header), so participants can update their
 * profile mid-event.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, Calendar, Loader2, Rocket, Users } from 'lucide-react';
import { toast } from 'sonner';
import StartupProfileForm from '@/components/StartupProfileForm';
import FacilitatorProfileForm from '@/components/FacilitatorProfileForm';
import ReadinessChecklist, { ChecklistItem } from '@/components/ReadinessChecklist';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/timezone';
import { getAdminToken } from '@/lib/adminAuth';

interface SessionRow {
  id: string;
  name: string;
  status: string;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
}

interface StartupRow {
  email: string;
  display_name: string | null;
  description: string | null;
  funding_goal: number | null;
  image_url: string | null;
}

export default function GreenRoom() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useSessionUser();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [selfRow, setSelfRow] = useState<any>(null);
  const [startups, setStartups] = useState<StartupRow[]>([]);
  const [goingLive, setGoingLive] = useState(false);

  // Investors don't have a profile — bounce them straight in.
  useEffect(() => {
    if (!user || !id) {
      navigate('/login');
      return;
    }
    if (user.role === 'investor') {
      navigate(`/session/${id}`, { replace: true });
    }
  }, [user, id, navigate]);

  // Load session + own row + (for facilitators) the startup roster.
  const reload = async () => {
    if (!id || !user) return;
    const { data: sess } = await supabase
      .from('sessions')
      .select('id, name, status, start_time, end_time, timezone')
      .eq('id', id)
      .maybeSingle();
    if (sess) setSession(sess as SessionRow);

    const { data: me } = await supabase
      .from('session_participants')
      .select('id, role, description, funding_goal, dd_room_link, website_link, image_url, bio')
      .eq('session_id', id)
      .eq('email', user.email)
      .maybeSingle();
    if (me) setSelfRow(me);

    if (user.role === 'facilitator') {
      const { data: rost } = await supabase
        .from('session_participants')
        .select('email, display_name, description, funding_goal, image_url')
        .eq('session_id', id)
        .eq('role', 'startup')
        .order('presentation_order', { ascending: true });
      if (rost) setStartups(rost as StartupRow[]);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.email]);

  if (!user || user.role === 'investor') return null;

  const startupChecklist = (row: any): ChecklistItem[] => [
    { label: 'Logo / image', done: !!row?.image_url, required: false },
    { label: 'Short description', done: !!(row?.description || '').trim(), required: true },
    { label: 'Funding goal', done: row?.funding_goal != null && row.funding_goal > 0, required: true },
    { label: 'Due-diligence room link', done: !!row?.dd_room_link, required: false },
    { label: 'Website link', done: !!row?.website_link, required: false },
  ];
  const facilitatorChecklist = (row: any): ChecklistItem[] => [
    { label: 'Profile photo', done: !!row?.image_url, required: false },
    { label: 'Short bio', done: !!(row?.bio || '').trim(), required: false },
  ];

  const myChecklist = user.role === 'startup'
    ? startupChecklist(selfRow)
    : facilitatorChecklist(selfRow);

  const isStartupReady = (s: StartupRow) =>
    !!(s.description || '').trim() && s.funding_goal != null && s.funding_goal > 0;
  const startupsIncomplete = startups.filter(s => !isStartupReady(s));

  const handleGoLive = async () => {
    if (!id) return;
    if (startupsIncomplete.length > 0) {
      const ok = window.confirm(
        `${startupsIncomplete.length} startup${startupsIncomplete.length === 1 ? '' : 's'} ` +
        `haven't finished their profile yet. Go live anyway?`,
      );
      if (!ok) return;
    }
    setGoingLive(true);
    const { data, error } = await supabase.functions.invoke('admin-action', {
      body: { admin_token: getAdminToken(), action: 'update_session', id, status: 'live' },
    });
    setGoingLive(false);
    if (error || (data as any)?.error) {
      toast.error('Could not start the session.');
      return;
    }
    toast.success('Session is now live.');
    navigate(`/session/${id}`);
  };

  const scheduledLabel = session?.start_time
    ? `${formatDateInTimeZone(session.start_time, session.timezone || 'UTC')} · ${formatTimeInTimeZone(session.start_time, session.timezone || 'UTC')}`
    : '';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Green Room</p>
            <h1 className="text-2xl font-bold">{session?.name || 'Session'}</h1>
            {scheduledLabel && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                <Calendar className="w-3.5 h-3.5" />
                {scheduledLabel}
                <span
                  className={
                    'ml-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ' +
                    (session?.status === 'live'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-muted text-muted-foreground border border-border')
                  }
                >
                  {session?.status}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 items-end">
            <Button onClick={() => id && navigate(`/session/${id}`)}>
              Enter session <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
            {user.role === 'facilitator' && session?.status === 'scheduled' && (
              <Button
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={goingLive}
                onClick={handleGoLive}
                data-testid="green-room-go-live-btn"
              >
                {goingLive ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Rocket className="w-4 h-4 mr-1" />}
                Go live
              </Button>
            )}
          </div>
        </div>

        {/* Checklist */}
        <div className="mb-6">
          <ReadinessChecklist items={myChecklist} />
        </div>

        {/* Profile editor */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              {user.role === 'startup' ? 'Your startup profile' : 'Your facilitator profile'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {id && (
              user.role === 'startup'
                ? <StartupProfileForm sessionId={id} email={user.email} onSaved={reload} />
                : <FacilitatorProfileForm sessionId={id} email={user.email} onSaved={reload} />
            )}
          </CardContent>
        </Card>

        {/* Facilitator-only roster */}
        {user.role === 'facilitator' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" /> Startup readiness ({startups.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {startups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No startups registered yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {startups.map((s) => {
                    const ready = isStartupReady(s);
                    return (
                      <li key={s.email} className="py-2 flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-muted overflow-hidden flex items-center justify-center shrink-0">
                          {s.image_url
                            ? <img src={s.image_url} alt="" className="w-full h-full object-cover" />
                            : <Rocket className="w-4 h-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {s.display_name || s.email}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {s.description ? s.description.slice(0, 100) : 'No description yet'}
                          </div>
                        </div>
                        <span
                          className={
                            'text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0 ' +
                            (ready
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-400 border border-amber-500/30')
                          }
                        >
                          {ready ? 'Ready' : 'Incomplete'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
