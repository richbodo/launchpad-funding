import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import FundingMeter from '@/components/FundingMeter';
import ChatPanel from '@/components/ChatPanel';
import VideoPane from '@/components/VideoPane';
import SessionTimer from '@/components/SessionTimer';
import InvestDialog from '@/components/InvestDialog';
import { Button } from '@/components/ui/button';
import { DollarSign, ExternalLink, LogOut } from 'lucide-react';

interface Startup {
  email: string;
  display_name: string | null;
  presentation_order: number | null;
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout } = useSessionUser();
  const [totalFunded, setTotalFunded] = useState(0);
  const [startupFunded, setStartupFunded] = useState(0);
  const [startups, setStartups] = useState<Startup[]>([]);
  const [currentStartupIndex, setCurrentStartupIndex] = useState(0);
  const [investOpen, setInvestOpen] = useState(false);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    if (!user || !id) {
      navigate('/login');
      return;
    }

    const fetchData = async () => {
      // Session info
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();
      setSession(sessionData);

      // Startups
      const { data: startupData } = await supabase
        .from('session_participants')
        .select('email, display_name, presentation_order')
        .eq('session_id', id)
        .eq('role', 'startup')
        .order('presentation_order', { ascending: true });
      if (startupData) setStartups(startupData);

      // Investments
      const { data: investData } = await supabase
        .from('investments')
        .select('amount, startup_email')
        .eq('session_id', id);
      if (investData) {
        setTotalFunded(investData.reduce((sum, i) => sum + Number(i.amount), 0));
      }
    };
    fetchData();

    // Subscribe to investments
    const channel = supabase
      .channel(`investments-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'investments',
        filter: `session_id=eq.${id}`,
      }, (payload) => {
        const inv = payload.new as any;
        setTotalFunded(prev => prev + Number(inv.amount));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, user, navigate]);

  const currentStartup = startups[currentStartupIndex];
  const currentStartupName = currentStartup?.display_name || currentStartup?.email || 'Startup';

  const handleLogout = async () => {
    if (user && id) {
      await supabase
        .from('session_participants')
        .update({ is_logged_in: false })
        .eq('session_id', id)
        .eq('email', user.email);

      await supabase.from('session_logs').insert({
        session_id: id,
        event_type: 'logout',
        event_data: { email: user.email, role: user.role },
        actor_email: user.email,
      });
    }
    logout();
    navigate('/login');
  };

  if (!user || !id) return null;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Funding meter */}
      <FundingMeter
        totalFunded={totalFunded}
        currentStartup={currentStartupName}
        startupFunded={startupFunded}
      />

      {/* Session header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-sm">{session?.name || 'Funding Session'}</h2>
          <SessionTimer
            startTime={session?.start_time || ''}
            endTime={session?.end_time || ''}
            currentPhase="Presentation"
            phaseEndTime={new Date(Date.now() + 5 * 60 * 1000)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{user.displayName} ({user.role})</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main content: 3-pane layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left pane: Facilitator video */}
        <div className="md:w-72 lg:w-80 shrink-0 p-3 border-b md:border-b-0 md:border-r border-border">
          <VideoPane label="Facilitator" sublabel="Host Stream" />
        </div>

        {/* Center pane: Startup presentation */}
        <div className="flex-1 flex flex-col p-3 min-w-0">
          <div className="flex-1 rounded-lg overflow-hidden">
            <VideoPane
              label={currentStartupName}
              sublabel="Startup Presentation"
              isActive={true}
            />
          </div>

          {/* Startup navigation (facilitator only) */}
          {user.role === 'facilitator' && startups.length > 1 && (
            <div className="flex items-center justify-center gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={currentStartupIndex === 0}
                onClick={() => setCurrentStartupIndex(i => i - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground mono">
                {currentStartupIndex + 1} / {startups.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentStartupIndex === startups.length - 1}
                onClick={() => setCurrentStartupIndex(i => i + 1)}
              >
                Next
              </Button>
            </div>
          )}

          {/* Investor actions */}
          {user.role === 'investor' && currentStartup && (
            <div className="flex items-center justify-center gap-3 mt-3">
              <Button
                onClick={() => setInvestOpen(true)}
                className="bg-accent text-accent-foreground hover:bg-accent/90 font-semibold px-6"
              >
                <DollarSign className="w-4 h-4 mr-1" />
                Invest
              </Button>
              <Button variant="outline" size="sm">
                <ExternalLink className="w-4 h-4 mr-1" />
                DD Room
              </Button>
            </div>
          )}
        </div>

        {/* Right pane: Chat */}
        <div className="md:w-80 lg:w-96 shrink-0 h-64 md:h-auto">
          <ChatPanel sessionId={id} />
        </div>
      </div>

      {/* Invest dialog */}
      {currentStartup && (
        <InvestDialog
          open={investOpen}
          onOpenChange={setInvestOpen}
          sessionId={id}
          startupName={currentStartup.display_name || currentStartup.email}
          startupEmail={currentStartup.email}
        />
      )}
    </div>
  );
}
