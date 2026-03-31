import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { useDemoMode } from '@/hooks/useDemoMode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Trash2, Calendar, Users, ArrowLeft, Play, X, Eye, EyeOff, Archive, FileText, Download, ArrowUpDown, Settings2, Settings, RefreshCw, Mail, Pencil, Check } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { motion } from 'framer-motion';
import DemoModeBanner from '@/components/DemoModeBanner';

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

interface EmailLogRow {
  id: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

// Default welcome messages
const DEFAULT_WELCOME_FACILITATOR = "Welcome! As a facilitator, you'll be managing the session flow, coordinating presenters, and guiding Q&A.";
const DEFAULT_WELCOME_STARTUP = "Welcome! You've been selected to pitch at this session. Prepare your presentation and be ready to take questions from investors.";
const DEFAULT_WELCOME_INVESTOR = "Welcome! You'll be reviewing startup pitches and can pledge funding to teams you believe in.";
const DEFAULT_CONTACT_EMAIL = "noreply@pitch.globaldonut.com";

export default function Admin() {
  const navigate = useNavigate();
  const { user: sessionUser } = useSessionUser();
  const { isDemoMode: isDemoModeActive } = useDemoMode();
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

  // Send email dialog
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [pendingParticipant, setPendingParticipant] = useState<{ email: string; name: string; role: string } | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Email settings
  const [emailContact, setEmailContact] = useState(DEFAULT_CONTACT_EMAIL);
  const [welcomeFacilitator, setWelcomeFacilitator] = useState(DEFAULT_WELCOME_FACILITATOR);
  const [welcomeStartup, setWelcomeStartup] = useState(DEFAULT_WELCOME_STARTUP);
  const [welcomeInvestor, setWelcomeInvestor] = useState(DEFAULT_WELCOME_INVESTOR);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Email logs
  const [emailLogs, setEmailLogs] = useState<EmailLogRow[]>([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);
  const [timelineLog, setTimelineLog] = useState<EmailLogRow | null>(null);
  const [timeline, setTimeline] = useState<EmailLogRow[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // --- Email Settings persistence ---
  const fetchEmailSettings = async () => {
    const keys = ['email_contact', 'email_welcome_facilitator', 'email_welcome_startup', 'email_welcome_investor'];
    const { data } = await supabase.from('app_settings').select('key, value').in('key', keys);
    if (data) {
      for (const row of data) {
        if (row.key === 'email_contact') setEmailContact(row.value);
        if (row.key === 'email_welcome_facilitator') setWelcomeFacilitator(row.value);
        if (row.key === 'email_welcome_startup') setWelcomeStartup(row.value);
        if (row.key === 'email_welcome_investor') setWelcomeInvestor(row.value);
      }
    }
  };

  const saveEmailSetting = async (key: string, value: string) => {
    setSavingSettings(true);
    const { error } = await supabase.from('app_settings').upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if (error) toast.error('Failed to save setting');
    else toast.success('Setting saved');
    setSavingSettings(false);
    setEditingField(null);
  };

  // --- Email Logs ---
  const fetchEmailLogs = async () => {
    setEmailLogsLoading(true);
    const { data, error } = await supabase.functions.invoke('email-logs', {
      body: { limit: 100 },
    });
    if (error) {
      toast.error('Failed to load email logs');
    } else if (data?.logs) {
      setEmailLogs(data.logs);
    }
    setEmailLogsLoading(false);
  };

  const fetchTimeline = async (log: EmailLogRow) => {
    setTimelineLog(log);
    setTimelineLoading(true);
    const messageId = log.message_id || log.id;
    const { data, error } = await supabase.functions.invoke('email-logs', {
      body: { message_id: messageId },
    });
    if (error) {
      toast.error('Failed to load delivery timeline');
      setTimeline([]);
    } else {
      setTimeline(data?.timeline ?? []);
    }
    setTimelineLoading(false);
  };

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

  // In demo mode, auto-login as the first available facilitator
  useEffect(() => {
    if (!isDemoModeActive || isAuthenticated) return;
    const autoLogin = async () => {
      const { data: facilitators } = await supabase
        .from('session_participants')
        .select('email')
        .eq('role', 'facilitator')
        .limit(1);
      if (facilitators && facilitators.length > 0) {
        setAdminEmail(facilitators[0].email);
        setIsAuthenticated(true);
        fetchSessions();
      }
    };
    autoLogin();
  }, [isDemoModeActive, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchDemoMode();
      fetchEmailSettings();
    }
  }, [isAuthenticated]);

  const createSession = async () => {
    if (!newName || !newDate || !newStartTime || !newEndTime) {
      toast.error('Please fill all fields');
      return;
    }
    const startISO = new Date(`${newDate}T${newStartTime}`).toISOString();
    const endISO = new Date(`${newDate}T${newEndTime}`).toISOString();

    const { data: overlapping } = await supabase
      .from('sessions')
      .select('id, name')
      .lt('start_time', endISO)
      .gt('end_time', startISO)
      .neq('status', 'completed');

    if (overlapping && overlapping.length > 0) {
      toast.error(`Time conflict with "${overlapping[0].name}". Only one session can be active at a time.`);
      return;
    }

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

    const normalizedEmail = addEmail.toLowerCase().trim();

    // Pre-check to avoid duplicate key errors and allow resending invites.
    const { data: existingParticipant, error: existingLookupError } = await supabase
      .from('session_participants')
      .select('id, role, display_name')
      .eq('session_id', selectedSession.id)
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingLookupError) {
      toast.error('Could not verify existing participant. Please try again.', { duration: 15000 });
      return;
    }

    if (existingParticipant) {
      if (existingParticipant.role !== addRole) {
        toast.error(
          `${normalizedEmail} is already registered for this session as ${existingParticipant.role}.`,
          { duration: 15000 }
        );
        return;
      }

      setPendingParticipant({
        email: normalizedEmail,
        name: existingParticipant.display_name || addName,
        role: addRole,
      });
      setEmailDialogOpen(true);
      toast.info('Participant already exists — you can resend the invitation email.', { duration: 10000 });
      return;
    }

    let nextOrder: number | null = null;
    if (addRole === 'startup') {
      const startupOrders = participants
        .filter(p => p.role === 'startup' && p.presentation_order != null)
        .map(p => p.presentation_order!);
      nextOrder = startupOrders.length > 0 ? Math.max(...startupOrders) + 1 : 1;
    }

    const { error } = await supabase.from('session_participants').insert([{
      session_id: selectedSession.id,
      email: normalizedEmail,
      role: addRole as "facilitator" | "investor" | "startup",
      display_name: addName || null,
      password_hash: addRole === 'facilitator' ? addPassword : null,
      presentation_order: nextOrder,
    }]);

    if (error) {
      if (error.code === '23505' || error.message.includes('session_participants_session_id_email_key')) {
        setPendingParticipant({ email: normalizedEmail, name: addName, role: addRole });
        setEmailDialogOpen(true);
        toast.info('Participant already exists — opening email dialog to resend invite.', { duration: 10000 });
        return;
      }

      toast.error(error.message || 'Failed to add participant', { duration: 15000 });
      return;
    }

    // Show email dialog
    setPendingParticipant({ email: normalizedEmail, name: addName, role: addRole });
    setEmailDialogOpen(true);

    toast.success('Participant added');
    setAddEmail('');
    setAddName('');
    setAddPassword('');
    fetchParticipants(selectedSession.id);
  };

  const sendWelcomeEmail = async () => {
    if (!pendingParticipant || !selectedSession) return;
    setSendingEmail(true);
    try {
      const { role, email, name } = pendingParticipant;
      const welcomeMsg = role === 'facilitator' ? welcomeFacilitator
        : role === 'startup' ? welcomeStartup : welcomeInvestor;

      const sessionDate = new Date(selectedSession.start_time).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      const startT = new Date(selectedSession.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const endT = new Date(selectedSession.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      const sessionTime = `${startT} — ${endT}`;

      const loginUrl = `${window.location.origin}/login?session=${selectedSession.id}&email=${encodeURIComponent(email)}&role=${role}${role === 'startup' ? '&edit=true' : ''}`;

      // Google Calendar link
      const calStart = new Date(selectedSession.start_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const calEnd = new Date(selectedSession.end_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(selectedSession.name)}&dates=${calStart}/${calEnd}&details=${encodeURIComponent('Join: ' + loginUrl)}`;

      const { data, error } = await supabase.functions.invoke('send-transactional-email', {
        body: {
          templateName: 'session-invitation',
          recipientEmail: email,
          idempotencyKey: `session-invite-${selectedSession.id}-${email}`,
          templateData: {
            recipientName: name || undefined,
            roleName: role,
            sessionName: selectedSession.name,
            sessionDate,
            sessionTime,
            welcomeMessage: welcomeMsg,
            loginUrl,
            calendarUrl,
            contactEmail: emailContact !== DEFAULT_CONTACT_EMAIL ? emailContact : undefined,
          },
        },
      });

      if (error) {
        console.error('Email send error:', error);
        throw error;
      }

      // Check if the response itself indicates failure
      if (data && data.error) {
        console.error('Email send response error:', data);
        throw new Error(data.error);
      }

      console.log('Email send response:', data);
      toast.success(`Invitation email queued for ${email}`);
    } catch (err: any) {
      const errMsg = err?.message || err?.context?.message || JSON.stringify(err) || 'Failed to send email';
      console.error('Email send failed:', err);
      toast.error(`Email failed: ${errMsg}`, { duration: 15000 });
    } finally {
      setSendingEmail(false);
      setEmailDialogOpen(false);
      setPendingParticipant(null);
    }
  };

  const removeParticipant = async (id: string) => {
    await supabase.from('session_participants').delete().eq('id', id);
    if (selectedSession) fetchParticipants(selectedSession.id);
    toast.success('Participant removed');
  };

  const changeStartupOrder = async (participantId: string, newOrder: number) => {
    const startups = participants
      .filter(p => p.role === 'startup')
      .sort((a, b) => (a.presentation_order ?? 0) - (b.presentation_order ?? 0));

    const movedStartup = startups.find(s => s.id === participantId);
    if (!movedStartup) return;

    const oldOrder = movedStartup.presentation_order ?? 0;
    if (oldOrder === newOrder) return;

    const without = startups.filter(s => s.id !== participantId);
    without.splice(newOrder - 1, 0, movedStartup);

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

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      sent: 'bg-accent/10 text-accent',
      pending: 'bg-amber-500/10 text-amber-600',
      failed: 'bg-destructive/10 text-destructive',
      dlq: 'bg-destructive/10 text-destructive',
      suppressed: 'bg-muted text-muted-foreground',
      bounced: 'bg-destructive/10 text-destructive',
      complained: 'bg-destructive/10 text-destructive',
      rate_limited: 'bg-amber-500/10 text-amber-600',
    };
    return <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors[status] || 'bg-muted text-muted-foreground'}`}>{status}</span>;
  };

  // Contextual delivery interpretation for the timeline
  const deliveryContextLabel = (event: EmailLogRow, allEvents: EmailLogRow[]) => {
    const hasBounce = allEvents.some(e => e.status === 'bounced');
    const hasComplaint = allEvents.some(e => e.status === 'complained');
    const hasSent = allEvents.some(e => e.status === 'sent');
    const sentEvent = allEvents.find(e => e.status === 'sent');

    if (event.status === 'pending') {
      return <span className="text-xs text-muted-foreground italic">Queued locally — waiting to be sent to mail server</span>;
    }
    if (event.status === 'sent') {
      if (hasBounce) {
        return <span className="text-xs text-destructive italic">Accepted by mail server, but later bounced</span>;
      }
      if (hasComplaint) {
        return <span className="text-xs text-amber-600 italic">Accepted by mail server, but recipient complained (spam)</span>;
      }
      const sentAt = new Date(event.created_at).getTime();
      const minutesSinceSend = (Date.now() - sentAt) / 60000;
      if (minutesSinceSend > 10) {
        return <span className="text-xs text-accent italic">✓ Accepted by mail server — no bounce detected, likely delivered</span>;
      }
      return <span className="text-xs text-muted-foreground italic">Accepted by mail server — waiting for bounce/complaint window (~10 min)</span>;
    }
    if (event.status === 'rate_limited') {
      return <span className="text-xs text-amber-600 italic">Mail API rate limit hit — will retry automatically</span>;
    }
    if (event.status === 'failed') {
      return <span className="text-xs text-destructive italic">Send attempt failed — will retry up to 5 times</span>;
    }
    if (event.status === 'dlq') {
      return <span className="text-xs text-destructive italic">Permanently failed — moved to dead letter queue after max retries or TTL</span>;
    }
    if (event.status === 'bounced') {
      return <span className="text-xs text-destructive italic">Mail server reported bounce — email was not delivered to recipient</span>;
    }
    if (event.status === 'complained') {
      return <span className="text-xs text-destructive italic">Recipient marked email as spam</span>;
    }
    if (event.status === 'suppressed') {
      return <span className="text-xs text-muted-foreground italic">Recipient is on suppression list — email was not sent</span>;
    }
    return null;
  };

  // Editable welcome message component
  const EditableWelcome = ({ label, settingKey, value, setValue }: {
    label: string; settingKey: string; value: string; setValue: (v: string) => void;
  }) => {
    const isEditing = editingField === settingKey;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{label}</Label>
          {isEditing ? (
            <Button variant="ghost" size="sm" onClick={() => saveEmailSetting(settingKey, value)} disabled={savingSettings}>
              <Check className="w-3.5 h-3.5 mr-1" /> Save
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setEditingField(settingKey)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        {isEditing ? (
          <Textarea value={value} onChange={e => setValue(e.target.value)} rows={3} className="text-sm" />
        ) : (
          <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg whitespace-pre-wrap">{value}</p>
        )}
      </div>
    );
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <DemoModeBanner />
        <div className="flex-1 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold">Facilitator Login</h1>
            <p className="text-muted-foreground mt-1">Facilitators manage sessions and administer the app</p>
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DemoModeBanner />
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
            <TabsTrigger value="email-logs" onClick={() => fetchEmailLogs()}><Mail className="w-4 h-4 mr-1" /> Email Logs</TabsTrigger>
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
            <div className="space-y-6">
              {/* Demo Mode */}
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

              {/* Email Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5" /> Email Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Facilitator Contact Email</Label>
                      {editingField === 'email_contact' ? (
                        <Button variant="ghost" size="sm" onClick={() => saveEmailSetting('email_contact', emailContact)} disabled={savingSettings}>
                          <Check className="w-3.5 h-3.5 mr-1" /> Save
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setEditingField('email_contact')}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    {editingField === 'email_contact' ? (
                      <Input value={emailContact} onChange={e => setEmailContact(e.target.value)} type="email" className="text-sm" />
                    ) : (
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">{emailContact}</p>
                    )}
                    <p className="text-xs text-muted-foreground">Shown in invitation emails as the reply-to contact.</p>
                  </div>

                  <hr className="border-border" />

                  <EditableWelcome
                    label="Facilitator Welcome Message"
                    settingKey="email_welcome_facilitator"
                    value={welcomeFacilitator}
                    setValue={setWelcomeFacilitator}
                  />
                  <EditableWelcome
                    label="Startup Welcome Message"
                    settingKey="email_welcome_startup"
                    value={welcomeStartup}
                    setValue={setWelcomeStartup}
                  />
                  <EditableWelcome
                    label="Investor Welcome Message"
                    settingKey="email_welcome_investor"
                    value={welcomeInvestor}
                    setValue={setWelcomeInvestor}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Email Logs Tab */}
          <TabsContent value="email-logs">
            {timelineLog ? (
              /* ── Full-page delivery timeline ── */
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => setTimelineLog(null)} className="mb-2">
                      <ArrowLeft className="w-4 h-4 mr-1" /> Back to logs
                    </Button>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Mail className="w-5 h-5" /> Delivery Timeline
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      To: <strong>{timelineLog.recipient_email}</strong> · Template: <strong>{timelineLog.template_name}</strong>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Message ID: <code className="bg-muted px-1 rounded">{timelineLog.message_id || timelineLog.id}</code>
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  {timelineLoading ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Loading timeline…</p>
                  ) : timeline.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No timeline events found</p>
                  ) : (
                    <div className="relative pl-6 space-y-0">
                      {/* Vertical line */}
                      <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border" />
                      {timeline.map((event, idx) => (
                        <div key={event.id} className="relative pb-6 last:pb-0">
                          {/* Dot */}
                          <div className={`absolute left-[-17px] top-1.5 w-3 h-3 rounded-full border-2 ${
                            event.status === 'sent' ? 'bg-accent border-accent' :
                            event.status === 'pending' ? 'bg-amber-500 border-amber-500' :
                            event.status === 'failed' || event.status === 'dlq' || event.status === 'bounced' ? 'bg-destructive border-destructive' :
                            'bg-muted-foreground border-muted-foreground'
                          }`} />
                          <div className="bg-muted/50 rounded-lg p-4">
                            <div className="flex items-center gap-3 mb-1">
                              {statusBadge(event.status)}
                              <span className="text-sm text-muted-foreground">
                                {new Date(event.created_at).toLocaleString()}
                              </span>
                              {idx === 0 && <span className="text-xs text-muted-foreground">(first event)</span>}
                              {idx === timeline.length - 1 && idx > 0 && <span className="text-xs text-muted-foreground">(latest)</span>}
                            </div>
                            <div className="mb-2">
                              {deliveryContextLabel(event, timeline)}
                            </div>
                            {event.error_message && (
                              <p className="text-sm text-destructive mb-2">Error: {event.error_message}</p>
                            )}
                            {event.metadata && (
                              <details className="text-xs">
                                <summary className="cursor-pointer hover:text-foreground text-muted-foreground font-medium">
                                  {event.metadata.api_response?.workflow_id
                                    ? `✓ Workflow: ${event.metadata.api_response.workflow_id}`
                                    : event.metadata.error_status
                                      ? `✗ HTTP ${event.metadata.error_status}`
                                      : 'View metadata'}
                                </summary>
                                <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto max-h-64 whitespace-pre-wrap break-all">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </pre>
                              </details>
                            )}
                            {!event.metadata && !event.error_message && (
                              <p className="text-xs text-muted-foreground/50 italic">No additional data captured at this stage</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              /* ── Summary list ── */
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5" /> Email Delivery Log
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={fetchEmailLogs} disabled={emailLogsLoading}>
                    <RefreshCw className={`w-4 h-4 mr-1 ${emailLogsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </CardHeader>
                <CardContent>
                  {emailLogsLoading ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
                  ) : emailLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No emails sent yet</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <p className="text-xs text-muted-foreground mb-3">Click any row to see full delivery timeline</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Template</TableHead>
                            <TableHead>Recipient</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {emailLogs.map(log => (
                            <TableRow
                              key={log.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => fetchTimeline(log)}
                            >
                              <TableCell className="text-sm">{log.template_name}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{log.recipient_email}</TableCell>
                              <TableCell>{statusBadge(log.status)}</TableCell>
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {new Date(log.created_at).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-sm text-destructive max-w-48 truncate" title={log.error_message || ''}>
                                {log.error_message || '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
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

      {/* Send Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={open => { if (!open) { setEmailDialogOpen(false); setPendingParticipant(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Invitation Email?</DialogTitle>
            <DialogDescription>
              Would you like to send a welcome email to <strong>{pendingParticipant?.email}</strong> with session details, a login link, and a calendar invite?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEmailDialogOpen(false); setPendingParticipant(null); }}>
              No, Skip
            </Button>
            <Button onClick={sendWelcomeEmail} disabled={sendingEmail} className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Mail className="w-4 h-4 mr-1" />
              {sendingEmail ? 'Sending…' : 'Yes, Send Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
