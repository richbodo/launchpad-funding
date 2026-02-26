import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser, UserRole } from '@/lib/sessionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { Rocket, Users, Briefcase, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

interface ActiveSession {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
}

export default function Login() {
  const navigate = useNavigate();
  const { setUser } = useSessionUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSessions = async () => {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('sessions')
        .select('id, name, start_time, end_time')
        .lte('start_time', now)
        .gte('end_time', now)
        .eq('status', 'live');

      // Also fetch scheduled sessions within 15 min of start
      const soon = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const { data: upcoming } = await supabase
        .from('sessions')
        .select('id, name, start_time, end_time')
        .lte('start_time', soon)
        .gte('end_time', now)
        .eq('status', 'scheduled');

      const all = [...(data || []), ...(upcoming || [])];
      setActiveSessions(all);
      if (all.length === 1) setSelectedSession(all[0].id);
    };
    fetchSessions();
  }, []);

  const handleLogin = async () => {
    if (!email || !role || !selectedSession) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);

    try {
      // Check if participant exists in this session
      const { data: participant, error } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', selectedSession)
        .eq('email', email.toLowerCase())
        .eq('role', role)
        .maybeSingle();

      if (error || !participant) {
        toast.error('You are not registered for this session with this role.');
        setLoading(false);
        return;
      }

      // For facilitators, check password
      if (role === 'facilitator') {
        if (!password) {
          toast.error('Password required for facilitators');
          setLoading(false);
          return;
        }
        // Simple password check (stored as plain text for v1)
        if (participant.password_hash !== password) {
          toast.error('Incorrect password');
          setLoading(false);
          return;
        }
      }

      // Check if already logged in
      if (participant.is_logged_in) {
        toast.error('This email is already logged in to this session.');
        setLoading(false);
        return;
      }

      // Mark as logged in
      await supabase
        .from('session_participants')
        .update({ is_logged_in: true, logged_in_at: new Date().toISOString() })
        .eq('id', participant.id);

      // Log the login
      await supabase.from('session_logs').insert({
        session_id: selectedSession,
        event_type: 'login',
        event_data: { email, role },
        actor_email: email,
      });

      setUser({
        email: email.toLowerCase(),
        role,
        displayName: participant.display_name || email.split('@')[0],
        sessionId: selectedSession,
      });

      navigate(`/session/${selectedSession}`);
    } catch (err) {
      toast.error('Login failed. Please try again.');
    }
    setLoading(false);
  };

  const roles: { value: UserRole; label: string; icon: React.ReactNode; desc: string }[] = [
    { value: 'investor', label: 'Investor', icon: <Briefcase className="w-5 h-5" />, desc: 'View pitches & invest' },
    { value: 'startup', label: 'Startup', icon: <Rocket className="w-5 h-5" />, desc: 'Present your company' },
    { value: 'facilitator', label: 'Facilitator', icon: <Users className="w-5 h-5" />, desc: 'Manage the session' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-accent/10 mb-4">
            <TrendingUp className="w-7 h-7 text-accent" />
          </div>
          <h1 className="text-2xl font-bold">FundFlow</h1>
          <p className="text-muted-foreground mt-1">Real-time funding platform</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-5">
          {/* Session selection */}
          {activeSessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No active sessions right now.</p>
              <Button variant="outline" className="mt-4" onClick={() => navigate('/admin')}>
                Facilitator Admin
              </Button>
            </div>
          ) : (
            <>
              {activeSessions.length > 1 && (
                <div>
                  <Label>Session</Label>
                  <select
                    value={selectedSession}
                    onChange={(e) => setSelectedSession(e.target.value)}
                    className="w-full mt-1.5 h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select a session...</option>
                    {activeSessions.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {activeSessions.length === 1 && (
                <div className="text-center pb-2">
                  <p className="text-sm text-muted-foreground">Joining</p>
                  <p className="font-semibold text-lg">{activeSessions[0].name}</p>
                </div>
              )}

              {/* Role selection */}
              <div>
                <Label className="mb-2 block">I am a...</Label>
                <div className="grid grid-cols-3 gap-2">
                  {roles.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setRole(r.value)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
                        role === r.value
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <span className={role === r.value ? 'text-accent' : 'text-muted-foreground'}>{r.icon}</span>
                      <span className="text-xs font-medium">{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Email */}
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="mt-1.5"
                />
              </div>

              {/* Password (facilitators only) */}
              {role === 'facilitator' && (
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="mt-1.5"
                  />
                </div>
              )}

              {/* Submit */}
              <Button
                onClick={handleLogin}
                disabled={loading || !email || !role}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90 h-11 text-base font-semibold"
              >
                {loading ? 'Joining...' : 'Join Session'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          <button onClick={() => navigate('/admin')} className="hover:text-foreground underline-offset-2 hover:underline">
            Facilitator Admin →
          </button>
        </p>
      </motion.div>
    </div>
  );
}

// Need this import
import { TrendingUp } from 'lucide-react';
