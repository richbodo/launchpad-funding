import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Trash2, Calendar, Users, ArrowLeft, Play, X, Eye, EyeOff, Archive, FileText, Download, ArrowUpDown, Settings2, Settings, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
  dd_room_link: string | null;
  website_link: string | null;
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
  const [chatArchives, setChatArchives] = useState<{ name: string; url: string }[]>([]);
  const [archiving, setArchiving] = useState(false);

  // Demo mode
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  // New session form
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newStartTime, setNewStartTime] = useState('09:00');
  const [newEndTime, setNewEndTime] = useState('11:00');
  const [newTimezone, setNewTimezone] = useState('America/New_York');

  // Add participant form
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<string>('investor');
  const [addName, setAddName] = useState('');
  const [addPassword, setAddPassword] = useState('');

  // Sort state
  const [sortBy, setSortBy] = useState<'role' | 'display_name'>('role');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Metadata dialog
  const [metaParticipant, setMetaParticipant] = useState<ParticipantRow | null>(null);
  const [metaDDRoom, setMetaDDRoom] = useState('');
  const [metaWebsite, setMetaWebsite] = useState('');

  const handleAdminLogin = async () => {
    const { data: facilitators, error } = await supabase
      .from('session_participants')
      .select('*')
      .eq('email', adminEmail.toLowerCase())
      .eq('role', 'facilitator');

    if (error || !facilitators || facilitators.length === 0) {
      toast.error('No facilitator account found with this email');
      return;
    }

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

  const fetchChatArchives = async (sessionId: string) => {
    const { data } = await supabase.storage
      .from('chat-archives')
      .list(sessionId, { sortBy: { column: 'created_at', order: 'desc' } });
    if (data) {
      const files = data.map(f => {
        const { data: urlData } = supabase.storage
          .from('chat-archives')
          .getPublicUrl(`${sessionId}/${f.name}`);
        return { name: f.name, url: urlData.publicUrl };
      });
      setChatArchives(files);
    } else {
      setChatArchives([]);
    }
  };

  const archiveChat = async (sessionId: string) => {
    setArchiving(true);
    try {
      const { data, error } = await supabase.functions.invoke('archive-chat', {
        body: { session_id: sessionId },
      });
      if (error) throw error;
      toast.success(data.message || 'Chat archived');
      fetchChatArchives(sessionId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to archive chat');
    } finally {
      setArchiving(false);
    }
  };

  const fetchDemoMode = async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'mode')
      .single();
    setDemoMode(data?.value === 'demo');
  };

  const toggleDemoMode = async (enabled: boolean) => {
    setSeedingDemo(true);
    try {
      await supabase
        .from('app_settings')
        .update({ value: enabled ? 'demo' : 'production', updated_at: new Date().toISOString() })
        .eq('key', 'mode');

      if (enabled) {
        const { data, error } = await supabase.functions.invoke('seed-demo-data');
        if (error) throw error;
        toast.success(`Demo data seeded: ${data?.summary?.sessions_created} sessions, ${data?.summary?.participants_created} participants`);
      } else {
        // Clean up demo sessions
        const { data: demoSessions } = await supabase
          .from('sessions')
          .select('id')
          .like('name', '[DEMO]%');
        if (demoSessions && demoSessions.length > 0) {
          const ids = demoSessions.map(s => s.id);
          await supabase.from('chat_messages').delete().in('session_id', ids);
          await supabase.from('investments').delete().in('session_id', ids);
          await supabase.from('session_logs').delete().in('session_id', ids);
          await supabase.from('session_participants').delete().in('session_id', ids);
          await supabase.from('sessions').delete().like('name', '[DEMO]%');
        }
        toast.success('Demo mode disabled, demo data cleaned up');
      }
      setDemoMode(enabled);
      fetchSessions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle demo mode');
    } finally {
      setSeedingDemo(false);
    }
  };

  const refreshDemoData = async () => {
    setSeedingDemo(true);
    try {
      const { data, error } = await supabase.functions.invoke('seed-demo-data');
      if (error) throw error;
      toast.success(`Demo data refreshed: ${data?.summary?.sessions_created} sessions`);
      fetchSessions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to refresh demo data');
    } finally {
      setSeedingDemo(false);
    }
  };

  useEffect(() => {
    if (sessionUser && sessionUser.role === 'facilitator' && !isAuthenticated) {
      setIsAuthenticated(true);
      setAdminEmail(sessionUser.email);
      fetchSessions();
    }
  }, [sessionUser, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) fetchDemoMode();
  }, [isAuthenticated]);

  const createSession = async () => {
    if (!newName || !newDate || !newStartTime || !newEndTime) {
      toast.error('Please fill all fields');
      return;
    }
    const startISO = new Date(`${newDate}T${newStartTime}`).toISOString();
    const endISO = new Date(`${newDate}T${newEndTime}`).toISOString();
    const { error } = await supabase.from('sessions').insert({
      name: newName,
      start_time: startISO,
      end_time: endISO,
      timezone: newTimezone,
      status: 'scheduled' as const,
    });
    if (error) {
      toast.error('Failed to create session');
      return;
    }
    toast.success('Session created!');
    setNewName('');
    setNewDate('');
    setNewStartTime('09:00');
    setNewEndTime('11:00');
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
    if (!addEmail) {
      toast.error('Please enter an email address');
      return;
    }
    if (!selectedSession) return;

    // Auto-assign next presentation_order for startups
    let nextOrder: number | null = null;
    if (addRole === 'startup') {
      const startupOrders = participants
        .filter(p => p.role === 'startup' && p.presentation_order != null)
        .map(p => p.presentation_order!);
      nextOrder = startupOrders.length > 0 ? Math.max(...startupOrders) + 1 : 1;
    }

    const { error } = await supabase.from('session_participants').insert([{
      session_id: selectedSession.id,
      email: addEmail.toLowerCase(),
      role: addRole as "facilitator" | "investor" | "startup",
      display_name: addName || null,
      password_hash: addRole === 'facilitator' ? addPassword : null,
      presentation_order: nextOrder,
    }]);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Participant added');
    setAddEmail('');
    setAddName('');
    setAddPassword('');
    fetchParticipants(selectedSession.id);
  };

  const removeParticipant = async (id: string) => {
    await supabase.from('session_participants').delete().eq('id', id);
    if (selectedSession) fetchParticipants(selectedSession.id);
    toast.success('Participant removed');
  };

  // Reorder startup presentation_order
  const changeStartupOrder = async (participantId: string, newOrder: number) => {
    const startups = participants
      .filter(p => p.role === 'startup')
      .sort((a, b) => (a.presentation_order ?? 0) - (b.presentation_order ?? 0));

    const movedStartup = startups.find(s => s.id === participantId);
    if (!movedStartup) return;

    const oldOrder = movedStartup.presentation_order ?? 0;
    if (oldOrder === newOrder) return;

    // Remove moved startup, insert at new position
    const without = startups.filter(s => s.id !== participantId);
    without.splice(newOrder - 1, 0, movedStartup);

    // Batch update all with new sequential orders
    const updates = without.map((s, i) => ({
      id: s.id,
      newOrder: i + 1,
    }));

    for (const u of updates) {
      await supabase.from('session_participants')
        .update({ presentation_order: u.newOrder })
        .eq('id', u.id);
    }

    if (selectedSession) fetchParticipants(selectedSession.id);
  };

  // Save metadata
  const saveMetadata = async () => {
    if (!metaParticipant) return;
    const { error } = await supabase.from('session_participants')
      .update({
        dd_room_link: metaDDRoom || null,
        website_link: metaWebsite || null,
      })
      .eq('id', metaParticipant.id);
    if (error) {
      toast.error('Failed to save metadata');
      return;
    }
    toast.success('Metadata saved');
    setMetaParticipant(null);
    if (selectedSession) fetchParticipants(selectedSession.id);
  };

  const openMetadataDialog = (p: ParticipantRow) => {
    setMetaParticipant(p);
    setMetaDDRoom(p.dd_room_link || '');
    setMetaWebsite(p.website_link || '');
  };

  // Sorting
  const toggleSort = (col: 'role' | 'display_name') => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const sortedParticipants = [...participants].sort((a, b) => {
    const aVal = (sortBy === 'display_name' ? (a.display_name || a.email) : a.role).toLowerCase();
    const bVal = (sortBy === 'display_name' ? (b.display_name || b.email) : b.role).toLowerCase();
    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  const startupCount = participants.filter(p => p.role === 'startup').length;

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
            <TabsTrigger value="settings"><Settings className="w-4 h-4 mr-1" /> Settings</TabsTrigger>
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
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Start Time</Label>
                    <Input type="time" value={newStartTime} onChange={e => setNewStartTime(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>End Time</Label>
                    <Input type="time" value={newEndTime} onChange={e => setNewEndTime(e.target.value)} className="mt-1" />
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
                    onClick={() => { setSelectedSession(s); fetchParticipants(s.id); fetchChatArchives(s.id); }}
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
                      <Button type="button" onClick={addParticipant} size="sm" className="bg-accent text-accent-foreground">
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Participant table */}
                    {participants.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No participants yet</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('role')}>
                              <span className="flex items-center gap-1">
                                Type <ArrowUpDown className="w-3 h-3" />
                              </span>
                            </TableHead>
                            <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('display_name')}>
                              <span className="flex items-center gap-1">
                                Name <ArrowUpDown className="w-3 h-3" />
                              </span>
                            </TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Order</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedParticipants.map(p => (
                            <TableRow key={p.id}>
                              <TableCell>
                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                  p.role === 'facilitator' ? 'bg-amber-500/10 text-amber-500' :
                                  p.role === 'startup' ? 'bg-accent/10 text-accent' :
                                  'bg-blue-500/10 text-blue-500'
                                }`}>
                                  {p.role}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm">{p.display_name || '—'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{p.email}</TableCell>
                              <TableCell>
                                {p.role === 'startup' ? (
                                  <select
                                    value={p.presentation_order ?? 1}
                                    onChange={e => changeStartupOrder(p.id, parseInt(e.target.value))}
                                    className="h-8 rounded-md border border-input bg-background px-2 text-sm w-16"
                                  >
                                    {Array.from({ length: startupCount }, (_, i) => (
                                      <option key={i + 1} value={i + 1}>{i + 1}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {p.role === 'startup' && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openMetadataDialog(p)}
                                      title="Edit metadata"
                                    >
                                      <Settings2 className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="sm" onClick={() => removeParticipant(p.id)}>
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                {/* Chat Archives */}
                <Card className="mt-6">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5" /> Chat Archives
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={archiving}
                      onClick={() => archiveChat(selectedSession.id)}
                    >
                      <Archive className="w-4 h-4 mr-1" />
                      {archiving ? 'Archiving...' : 'Archive & Clear Chat'}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {chatArchives.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No archived chats yet</p>
                    ) : (
                      <div className="space-y-2">
                        {chatArchives.map(file => (
                          <div key={file.name} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50">
                            <span className="text-sm truncate flex-1">{file.name}</span>
                            <a href={file.url} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="sm">
                                <Download className="w-4 h-4" />
                              </Button>
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5" /> App Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label className="text-base font-medium">Demo Mode</Label>
                      {demoMode !== null && (
                        <Badge variant={demoMode ? 'default' : 'secondary'}>
                          {demoMode ? 'Active' : 'Off'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Seeds fixture sessions with test participants. Sessions stay active relative to the current time.
                    </p>
                  </div>
                  <Switch
                    checked={demoMode ?? false}
                    onCheckedChange={toggleDemoMode}
                    disabled={seedingDemo || demoMode === null}
                  />
                </div>

                {demoMode && (
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground flex-1">
                      Demo sessions get stale timestamps over time. Click refresh to re-seed with current times.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshDemoData}
                      disabled={seedingDemo}
                    >
                      <RefreshCw className={`w-4 h-4 mr-1 ${seedingDemo ? 'animate-spin' : ''}`} />
                      {seedingDemo ? 'Seeding...' : 'Refresh Demo Data'}
                    </Button>
                  </div>
                )}

                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>Demo credentials:</strong> facilitator@demo.com / demo123</p>
                  <p>Demo sessions are prefixed with [DEMO] and automatically cleaned up when switching to production.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Metadata Dialog */}
      <Dialog open={!!metaParticipant} onOpenChange={open => { if (!open) setMetaParticipant(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Startup Metadata — {metaParticipant?.display_name || metaParticipant?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>DD Room Link</Label>
              <Input
                value={metaDDRoom}
                onChange={e => setMetaDDRoom(e.target.value)}
                placeholder="https://..."
                className="mt-1"
              />
            </div>
            <div>
              <Label>Website Link</Label>
              <Input
                value={metaWebsite}
                onChange={e => setMetaWebsite(e.target.value)}
                placeholder="https://..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetaParticipant(null)}>Cancel</Button>
            <Button onClick={saveMetadata} className="bg-accent text-accent-foreground hover:bg-accent/90">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
