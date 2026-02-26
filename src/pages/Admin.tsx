import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Trash2, Calendar, Users, ArrowLeft, Play, X, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';

interface SessionRow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  timezone: string;
  status: string;
}

interface ParticipantRow {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  presentation_order: number | null;
}

export default function Admin() {
  const navigate = useNavigate();
  const { user: sessionUser } = useSessionUser();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  // New session form
  const [newName, setNewName] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newTimezone, setNewTimezone] = useState('America/New_York');

  // Add participant form
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<string>('investor');
  const [addName, setAddName] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addOrder, setAddOrder] = useState('');

  const handleAdminLogin = async () => {
    // Look up facilitator in any session's participants
    const { data: facilitators, error } = await supabase
      .from('session_participants')
      .select('*')
      .eq('email', adminEmail.toLowerCase())
      .eq('role', 'facilitator');

    if (error || !facilitators || facilitators.length === 0) {
      toast.error('No facilitator account found with this email');
      return;
    }

    // Check password against any matching facilitator record
    const match = facilitators.find(f => f.password_hash === adminPassword);
    if (!match) {
      toast.error('Invalid credentials');
      return;
    }

    setIsAuthenticated(true);
    fetchSessions();
  };

  const fetchSessions = async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .order('start_time', { ascending: false });
    if (data) setSessions(data);
  };

  const fetchParticipants = async (sessionId: string) => {
    const { data } = await supabase
      .from('session_participants')
      .select('*')
      .eq('session_id', sessionId)
      .order('role', { ascending: true });
    if (data) setParticipants(data as ParticipantRow[]);
  };

  // Auto-authenticate if already logged in as facilitator via session login
  useEffect(() => {
    if (sessionUser && sessionUser.role === 'facilitator' && !isAuthenticated) {
      setIsAuthenticated(true);
      setAdminEmail(sessionUser.email);
      fetchSessions();
    }
  }, [sessionUser, isAuthenticated]);

  const createSession = async () => {
    if (!newName || !newStart || !newEnd) {
      toast.error('Please fill all fields');
      return;
    }
    const { error } = await supabase.from('sessions').insert({
      name: newName,
      start_time: new Date(newStart).toISOString(),
      end_time: new Date(newEnd).toISOString(),
      timezone: newTimezone,
      status: 'scheduled' as const,
    });
    if (error) {
      toast.error('Failed to create session');
      return;
    }
    toast.success('Session created!');
    setNewName('');
    setNewStart('');
    setNewEnd('');
    fetchSessions();
  };

  const deleteSession = async (id: string) => {
    await supabase.from('sessions').delete().eq('id', id);
    toast.success('Session deleted');
    setSelectedSession(null);
    fetchSessions();
  };

  const updateSessionStatus = async (id: string, status: "draft" | "scheduled" | "live" | "completed") => {
    await supabase.from('sessions').update({ status }).eq('id', id);
    toast.success(`Session ${status}`);
    fetchSessions();
  };

  const addParticipant = async () => {
    if (!addEmail || !selectedSession) return;
    const { error } = await supabase.from('session_participants').insert([{
      session_id: selectedSession.id,
      email: addEmail.toLowerCase(),
      role: addRole as "facilitator" | "investor" | "startup",
      display_name: addName || null,
      password_hash: addRole === 'facilitator' ? addPassword : null,
      presentation_order: addRole === 'startup' && addOrder ? parseInt(addOrder) : null,
    }]);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Participant added');
    setAddEmail('');
    setAddName('');
    setAddPassword('');
    setAddOrder('');
    fetchParticipants(selectedSession.id);
  };

  const removeParticipant = async (id: string) => {
    await supabase.from('session_participants').delete().eq('id', id);
    if (selectedSession) fetchParticipants(selectedSession.id);
    toast.success('Participant removed');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold">Admin Login</h1>
            <p className="text-muted-foreground mt-1">Facilitator access only</p>
          </div>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <Label>Email</Label>
                <Input value={adminEmail} onChange={e => setAdminEmail(e.target.value)} type="email" className="mt-1" />
              </div>
              <div>
                <Label>Password</Label>
                <div className="relative mt-1">
                  <Input value={adminPassword} onChange={e => setAdminPassword(e.target.value)} type={showAdminPassword ? 'text' : 'password'} className="pr-10" />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button onClick={handleAdminLogin} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                Sign In
              </Button>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground mt-4">
            <button onClick={() => navigate('/login')} className="hover:text-foreground underline-offset-2 hover:underline">
              ← Back to session login
            </button>
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-lg font-bold">Session Admin</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setIsAuthenticated(false); setAdminEmail(''); setAdminPassword(''); }}>
          Sign Out
        </Button>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        <Tabs defaultValue="sessions">
          <TabsList className="mb-6">
            <TabsTrigger value="sessions"><Calendar className="w-4 h-4 mr-1" /> Sessions</TabsTrigger>
            <TabsTrigger value="create"><Plus className="w-4 h-4 mr-1" /> New Session</TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <Card>
              <CardHeader>
                <CardTitle>Create New Session</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Session Name</Label>
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Q1 Demo Day" className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Start Time</Label>
                    <Input type="datetime-local" value={newStart} onChange={e => setNewStart(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>End Time</Label>
                    <Input type="datetime-local" value={newEnd} onChange={e => setNewEnd(e.target.value)} className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label>Timezone</Label>
                  <Input value={newTimezone} onChange={e => setNewTimezone(e.target.value)} placeholder="America/New_York" className="mt-1" />
                </div>
                <Button onClick={createSession} className="bg-accent text-accent-foreground hover:bg-accent/90">
                  <Plus className="w-4 h-4 mr-1" /> Create Session
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sessions">
            {!selectedSession ? (
              <div className="space-y-3">
                {sessions.length === 0 && (
                  <p className="text-muted-foreground text-center py-12">No sessions yet. Create one to get started.</p>
                )}
                {sessions.map(s => (
                  <Card
                    key={s.id}
                    className="cursor-pointer hover:border-accent/50 transition-colors"
                    onClick={() => { setSelectedSession(s); fetchParticipants(s.id); }}
                  >
                    <CardContent className="py-4 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{s.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {new Date(s.start_time).toLocaleString()} — {new Date(s.end_time).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          s.status === 'live' ? 'bg-accent/10 text-accent' :
                          s.status === 'completed' ? 'bg-muted text-muted-foreground' :
                          'bg-primary/10 text-primary'
                        }`}>
                          {s.status}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedSession(null)} className="mb-4">
                  <ArrowLeft className="w-4 h-4 mr-1" /> All Sessions
                </Button>

                <Card className="mb-6">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>{selectedSession.name}</CardTitle>
                    <div className="flex gap-2">
                      {selectedSession.status === 'scheduled' && (
                        <Button size="sm" onClick={() => updateSessionStatus(selectedSession.id, 'live')} className="bg-accent text-accent-foreground">
                          <Play className="w-4 h-4 mr-1" /> Go Live
                        </Button>
                      )}
                      {selectedSession.status === 'live' && (
                        <Button size="sm" variant="outline" onClick={() => updateSessionStatus(selectedSession.id, 'completed')}>
                          End Session
                        </Button>
                      )}
                      <Button size="sm" variant="destructive" onClick={() => deleteSession(selectedSession.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {new Date(selectedSession.start_time).toLocaleString()} — {new Date(selectedSession.end_time).toLocaleTimeString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Timezone: {selectedSession.timezone}</p>
                  </CardContent>
                </Card>

                {/* Participants */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" /> Participants
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Add participant form */}
                    <div className="flex flex-wrap gap-2 mb-4 p-3 rounded-lg bg-muted/50">
                      <Input
                        value={addEmail}
                        onChange={e => setAddEmail(e.target.value)}
                        placeholder="email@company.com"
                        className="flex-1 min-w-48"
                      />
                      <Input
                        value={addName}
                        onChange={e => setAddName(e.target.value)}
                        placeholder="Display Name"
                        className="w-36"
                      />
                      <select
                        value={addRole}
                        onChange={e => setAddRole(e.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="investor">Investor</option>
                        <option value="startup">Startup</option>
                        <option value="facilitator">Facilitator</option>
                      </select>
                      {addRole === 'facilitator' && (
                        <Input
                          value={addPassword}
                          onChange={e => setAddPassword(e.target.value)}
                          placeholder="Password"
                          type="password"
                          className="w-32"
                        />
                      )}
                      {addRole === 'startup' && (
                        <Input
                          value={addOrder}
                          onChange={e => setAddOrder(e.target.value)}
                          placeholder="Order #"
                          type="number"
                          className="w-20"
                        />
                      )}
                      <Button onClick={addParticipant} size="sm" className="bg-accent text-accent-foreground">
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Participant list */}
                    <div className="space-y-2">
                      {participants.map(p => (
                        <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                              p.role === 'facilitator' ? 'bg-amber-500/10 text-amber-500' :
                              p.role === 'startup' ? 'bg-accent/10 text-accent' :
                              'bg-blue-500/10 text-blue-500'
                            }`}>
                              {p.role}
                            </span>
                            <span className="text-sm">{p.display_name || p.email}</span>
                            <span className="text-xs text-muted-foreground">{p.email}</span>
                            {p.presentation_order != null && (
                              <span className="text-xs text-muted-foreground mono">#{p.presentation_order}</span>
                            )}
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => removeParticipant(p.id)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                      {participants.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">No participants yet</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
