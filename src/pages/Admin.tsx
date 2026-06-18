import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { useDemoMode } from '@/hooks/useDemoMode';
import { setAdminToken, getAdminToken, clearAdminToken } from '@/lib/adminAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Trash2, Calendar, Users, ArrowLeft, Play, X, Eye, EyeOff, Archive, FileText, Download, ArrowUpDown, Settings2, Settings, RefreshCw, Mail, Pencil, Check, Upload, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { motion } from 'framer-motion';
import DemoModeBanner from '@/components/DemoModeBanner';
import TimePicker from '@/components/TimePicker';
import TimezonePicker from '@/components/TimezonePicker';
import { reportError } from '@/lib/logError';
import { externalLinkHandler } from '@/lib/openExternal';
import {
  zonedWallTimeToUtcISO,
  utcIsoToZonedWallTime,
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from '@/lib/timezone';

/**
 * Invoke an admin edge function with the stored facilitator bearer token.
 * Returns `{ data, error }` mirroring supabase.functions.invoke's shape so
 * callers can check `error || data?.error` uniformly.
 */
async function invokeAdmin(action: string, payload: Record<string, unknown> = {}) {
  return supabase.functions.invoke('admin-action', {
    body: { admin_token: getAdminToken(), action, payload },
  });
}

/** Same pattern, dedicated to the small app_settings upsert surface. */
async function invokeAdminSetting(key: string, value: string) {
  return supabase.functions.invoke('admin-settings', {
    body: { admin_token: getAdminToken(), key, value },
  });
}

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
  funding_goal: number | null;
  invite_sent_at: string | null;
}

interface InvestmentRow {
  id: string;
  session_id: string;
  investor_email: string;
  investor_name: string | null;
  startup_email: string;
  startup_name: string | null;
  amount: number;
  email_status: 'draft' | 'queued' | 'sent' | 'cancelled';
  email_queued_at: string | null;
  email_sent_at: string | null;
  email_cancelled_at: string | null;
  created_at: string;
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
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [sendingQueuedEmails, setSendingQueuedEmails] = useState(false);
  const [cancellingQueuedEmails, setCancellingQueuedEmails] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [chatArchives, setChatArchives] = useState<{ name: string; url: string }[]>([]);
  const [archiving, setArchiving] = useState(false);
  const [activeTab, setActiveTab] = useState('sessions');



  // Demo mode
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  // New session form
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newStartTime, setNewStartTime] = useState('09:00');
  const [newEndTime, setNewEndTime] = useState('11:00');
  // Start empty so the facilitator must consciously pick the session's timezone
  // before choosing times — the times are interpreted in this zone.
  const [newTimezone, setNewTimezone] = useState('');

  // Edit-session form (for the currently-selected session in the details view)
  const [isEditingSession, setIsEditingSession] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('09:00');
  const [editEndTime, setEditEndTime] = useState('11:00');
  const [editTimezone, setEditTimezone] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

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
  const [metaFundingGoal, setMetaFundingGoal] = useState('');

  // Send email dialog
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [pendingParticipant, setPendingParticipant] = useState<{ email: string; name: string; role: string } | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Bulk invite send + CSV import
  const [sendingBulk, setSendingBulk] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);



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
    const { data, error } = await invokeAdminSetting(key, value);
    if (error || data?.error) toast.error('Failed to save setting');
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
    // Find any session where this facilitator exists to verify password
    const { data: facilitators, error } = await supabase
      .from('session_participants')
      .select('id, session_id')
      .eq('email', adminEmail.toLowerCase())
      .eq('role', 'facilitator')
      .limit(1);

    if (error || !facilitators || facilitators.length === 0) {
      toast.error('No facilitator account found with this email');
      return;
    }

    // Verify password server-side; participant-login returns an admin_token
    // we stash for subsequent admin-action calls.
    const { data, error: loginErr } = await supabase.functions.invoke('participant-login', {
      body: {
        session_id: facilitators[0].session_id,
        email: adminEmail.toLowerCase(),
        password: adminPassword,
      },
    });

    if (loginErr || !data?.success) {
      toast.error('Invalid credentials');
      return;
    }

    if (data.admin_token) setAdminToken(data.admin_token);
    setIsAuthenticated(true);
    fetchSessions();
  };

  const fetchSessions = async () => {
    let query = supabase
      .from('sessions')
      .select('*')
      .order('start_time', { ascending: false });
    // Hide [DEMO]-prefixed sessions when not in demo mode — they're test fixtures only.
    if (!isDemoModeActive) {
      query = query.not('name', 'like', '[DEMO]%');
    }
    const { data } = await query;
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

  /**
   * Load every soft commitment for the currently-selected session, regardless
   * of email status. The Admin "Investments & Commitments" card renders the
   * full audit trail, and the "Pending Approval" subsection only acts on rows
   * still in the `queued` state.
   */
  const fetchInvestments = async (sessionId: string) => {
    const { data, error } = await supabase
      .from('investments')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Failed to load investments', error);
      return;
    }
    if (data) setInvestments(data as InvestmentRow[]);
  };

  /**
   * Look up which participant the email belongs to so we can find a richer
   * display name when one wasn't captured at commitment time.
   */
  const participantDisplay = (email: string): string => {
    const p = participants.find(pp => pp.email.toLowerCase() === email.toLowerCase());
    return p?.display_name || email;
  };

  /**
   * Walk every `queued` investment for the selected session and dispatch a
   * single commitment-confirmation email per row (with both startup and
   * investor on the To: line). Rows that successfully enqueue flip to
   * `sent`; the rest stay `queued` so the facilitator can retry. The
   * underlying investment row is never deleted.
   */
  const sendAllQueuedCommitmentEmails = async () => {
    if (!selectedSession) return;
    const queued = investments.filter(i => i.email_status === 'queued');
    if (queued.length === 0) {
      toast.info('No emails are waiting for approval.');
      return;
    }
    setSendingQueuedEmails(true);
    let sent = 0;
    let failed = 0;
    for (const inv of queued) {
      try {
        const investorName = inv.investor_name || participantDisplay(inv.investor_email);
        const startupName = inv.startup_name || participantDisplay(inv.startup_email);
        const { data, error } = await supabase.functions.invoke('send-transactional-email', {
          body: {
            templateName: 'investment-commitment',
            recipientEmail: inv.investor_email,
            additionalRecipients: [inv.startup_email],
            idempotencyKey: `commitment-${inv.id}`,
            templateData: {
              investorName,
              investorEmail: inv.investor_email,
              startupName,
              startupEmail: inv.startup_email,
              amount: Number(inv.amount),
              sessionName: selectedSession.name,
            },
          },
        });
        if (error || data?.error) throw new Error(error?.message || data?.error || 'send failed');
        await supabase
          .from('investments')
          .update({ email_status: 'sent', email_sent_at: new Date().toISOString() })
          .eq('id', inv.id);
        sent++;
      } catch (err) {
        console.error('Failed to send commitment email', inv.id, err);
        failed++;
      }
    }
    setSendingQueuedEmails(false);
    await fetchInvestments(selectedSession.id);
    toast.success(
      `Sent ${sent} commitment email${sent === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}.`,
      { duration: failed ? 15000 : 6000 },
    );
  };

  /**
   * Cancel every queued email for this session. The investment rows stay in
   * the database (audit log preserved) — only the email status flips to
   * `cancelled` so the queue UI clears.
   */
  const cancelAllQueuedCommitmentEmails = async () => {
    if (!selectedSession) return;
    const queued = investments.filter(i => i.email_status === 'queued');
    if (queued.length === 0) return;
    setCancellingQueuedEmails(true);
    const { error } = await supabase
      .from('investments')
      .update({ email_status: 'cancelled', email_cancelled_at: new Date().toISOString() })
      .eq('session_id', selectedSession.id)
      .eq('email_status', 'queued');
    setCancellingQueuedEmails(false);
    if (error) {
      toast.error(`Failed to cancel: ${error.message}`);
      return;
    }
    await fetchInvestments(selectedSession.id);
    toast.success('Queued emails cancelled. Investment log preserved.');
  };

  /**
   * When a session is selected, keep the participants list live so edits made
   * by startups (DD Room URL, website, funding goal) and other facilitators
   * appear in the admin console without requiring a manual refresh.
   */
  useEffect(() => {
    if (!selectedSession) return;
    const channel = supabase
      .channel(`admin-participants-${selectedSession.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'session_participants',
        filter: `session_id=eq.${selectedSession.id}`,
      }, () => {
        fetchParticipants(selectedSession.id);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'investments',
        filter: `session_id=eq.${selectedSession.id}`,
      }, () => {
        fetchInvestments(selectedSession.id);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSession?.id]);

  const fetchChatArchives = async (sessionId: string) => {
    // chat-archives bucket is now private — pull list + signed URLs via the
    // facilitator-gated edge function.
    const { data, error } = await supabase.functions.invoke('chat-archives-list', {
      body: { admin_token: getAdminToken(), session_id: sessionId },
    });
    if (error || data?.error) {
      setChatArchives([]);
      return;
    }
    setChatArchives(data.files || []);
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
      // 1. Flip the mode flag (writes to app_settings via admin-settings).
      await invokeAdminSetting('mode', enabled ? 'demo' : 'production');

      if (enabled) {
        const { data, error } = await supabase.functions.invoke('seed-demo-data');
        if (error) throw error;
        toast.success(`Demo data seeded: ${data?.summary?.sessions_created} sessions, ${data?.summary?.participants_created} participants`);
      } else {
        // Atomic cleanup via admin-action so all locked-down writes happen
        // server-side with service_role.
        const { data, error } = await invokeAdmin('cleanup_demo');
        if (error || data?.error) throw new Error(data?.error || 'Cleanup failed');
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
    if (!newTimezone) {
      toast.error('Please pick a timezone first');
      return;
    }
    if (!newName || !newDate || !newStartTime || !newEndTime) {
      toast.error('Please fill all fields');
      return;
    }
    // Interpret the chosen wall-clock times as being in the session's timezone,
    // then store the absolute UTC instants.
    let startISO: string;
    let endISO: string;
    try {
      startISO = zonedWallTimeToUtcISO(newDate, newStartTime, newTimezone);
      endISO = zonedWallTimeToUtcISO(newDate, newEndTime, newTimezone);
    } catch (err) {
      reportError('Invalid date or time', err);
      return;
    }

    // Conflict check: only flag overlap with other *scheduled* sessions.
    // A currently 'live' session is the facilitator's active call — it doesn't
    // block scheduling future sessions (and 'completed' sessions are already
    // excluded for obvious reasons).
    const { data: overlapping, error: overlapError } = await supabase
      .from('sessions')
      .select('id, name')
      .lt('start_time', endISO)
      .gt('end_time', startISO)
      .eq('status', 'scheduled');

    if (overlapError) {
      reportError('Could not check for scheduling conflicts', overlapError);
      return;
    }

    if (overlapping && overlapping.length > 0) {
      toast.error(`Time conflict with "${overlapping[0].name}". Only one scheduled session can occupy a given time slot.`);
      return;
    }

    const { data: inserted, error } = await invokeAdmin('create_session', {
      name: newName,
      start_time: startISO,
      end_time: endISO,
      timezone: newTimezone,
      status: 'scheduled',
    });
    if (error || inserted?.error) {
      reportError('Failed to create session', error || new Error(inserted?.error));
      return;
    }
    toast.success('Session created!');
    setNewName('');
    setNewDate('');
    setNewStartTime('09:00');
    setNewEndTime('11:00');
    fetchSessions();
    setActiveTab('sessions');
  };

  const deleteSession = async (id: string) => {
    const { data, error } = await invokeAdmin('delete_session', { id });
    if (error || data?.error) {
      reportError('Failed to delete session', error || new Error(data?.error));
      return;
    }
    toast.success('Session deleted');
    setSelectedSession(null);
    fetchSessions();
  };

  const updateSessionStatus = async (id: string, status: "draft" | "scheduled" | "live" | "completed") => {
    const { data, error } = await invokeAdmin('update_session', { id, status });
    if (error || data?.error) {
      reportError(`Failed to set session to ${status}`, error || new Error(data?.error));
      return;
    }
    toast.success(`Session ${status}`);
    fetchSessions();
  };

  /**
   * Open the inline editor for the currently-selected session, pre-filling
   * every field (name, date, start/end time, timezone) from the stored UTC
   * instants decomposed back into the session's wall-clock zone.
   */
  const startEditingSession = () => {
    if (!selectedSession) return;
    const tz = selectedSession.timezone || 'UTC';
    const start = utcIsoToZonedWallTime(selectedSession.start_time, tz);
    const end = utcIsoToZonedWallTime(selectedSession.end_time, tz);
    setEditName(selectedSession.name);
    setEditDate(start.date);
    setEditStartTime(start.time);
    setEditEndTime(end.time);
    setEditTimezone(tz);
    setIsEditingSession(true);
  };

  const cancelEditingSession = () => {
    setIsEditingSession(false);
  };

  /**
   * Persist edits to the selected session — name, schedule (interpreted as
   * wall-clock in the chosen timezone), and timezone itself. Re-checks for
   * scheduling conflicts with *other* scheduled sessions before writing, so
   * editing can't create an overlap that creation would have rejected.
   */
  const saveSessionEdits = async () => {
    if (!selectedSession) return;
    if (!editName.trim()) {
      toast.error('Session name is required');
      return;
    }
    if (!editTimezone) {
      toast.error('Please pick a timezone');
      return;
    }
    if (!editDate || !editStartTime || !editEndTime) {
      toast.error('Please fill date, start and end time');
      return;
    }

    let startISO: string;
    let endISO: string;
    try {
      startISO = zonedWallTimeToUtcISO(editDate, editStartTime, editTimezone);
      endISO = zonedWallTimeToUtcISO(editDate, editEndTime, editTimezone);
    } catch (err) {
      reportError('Invalid date or time', err);
      return;
    }
    if (new Date(endISO) <= new Date(startISO)) {
      toast.error('End time must be after start time');
      return;
    }

    setSavingEdit(true);

    // Conflict check excludes the session being edited itself, and only
    // considers other *scheduled* sessions (matches createSession behavior).
    const { data: overlapping, error: overlapError } = await supabase
      .from('sessions')
      .select('id, name')
      .neq('id', selectedSession.id)
      .lt('start_time', endISO)
      .gt('end_time', startISO)
      .eq('status', 'scheduled');

    if (overlapError) {
      setSavingEdit(false);
      reportError('Could not check for scheduling conflicts', overlapError);
      return;
    }
    if (overlapping && overlapping.length > 0) {
      setSavingEdit(false);
      toast.error(`Time conflict with "${overlapping[0].name}". Only one scheduled session can occupy a given time slot.`);
      return;
    }

    const { data: updated, error } = await invokeAdmin('update_session', {
      id: selectedSession.id,
      name: editName.trim(),
      start_time: startISO,
      end_time: endISO,
      timezone: editTimezone,
    });

    setSavingEdit(false);
    if (error || updated?.error) {
      reportError('Failed to update session', error || new Error(updated?.error));
      return;
    }
    toast.success('Session updated');
    setIsEditingSession(false);
    if (updated?.session) setSelectedSession(updated.session as SessionRow);
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

    const { data: result, error } = await invokeAdmin('add_participant', {
      session_id: selectedSession.id,
      email: normalizedEmail,
      role: addRole,
      display_name: addName || null,
      password: addRole === 'facilitator' ? addPassword : null,
      presentation_order: nextOrder,
    });

    if (error || result?.error) {
      const msg = result?.error || error?.message || 'Failed to add participant';
      if (result?.error === 'duplicate' || /23505|session_id_email_key/.test(msg)) {
        setPendingParticipant({ email: normalizedEmail, name: addName, role: addRole });
        setEmailDialogOpen(true);
        toast.info('Participant already exists — opening email dialog to resend invite.', { duration: 10000 });
        return;
      }
      toast.error(msg, { duration: 15000 });
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

  /**
   * Build and queue a single session-invitation email. Throws on failure so
   * callers can count successes/failures. Does NOT touch UI state or sent
   * status — that is the caller's responsibility.
   */
  const buildAndSendInvite = async (email: string, name: string | null, role: string) => {
    if (!selectedSession) throw new Error('No session selected');
    const welcomeMsg = role === 'facilitator' ? welcomeFacilitator
      : role === 'startup' ? welcomeStartup : welcomeInvestor;

    const tz = selectedSession.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const sessionDate = formatDateInTimeZone(selectedSession.start_time, tz);
    const startT = formatTimeInTimeZone(selectedSession.start_time, tz);
    const endT = formatTimeInTimeZone(selectedSession.end_time, tz, true);
    const sessionTime = `${startT} — ${endT}`;

    const loginUrl = `${window.location.origin}/login?session=${selectedSession.id}&email=${encodeURIComponent(email)}&role=${role}${role === 'startup' ? '&edit=true' : ''}`;

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
    if (data && data.error) {
      console.error('Email send response error:', data);
      throw new Error(data.error);
    }
    return data;
  };

  /** Best-effort human message from an unknown thrown error. */
  const errMessage = (err: unknown): string => {
    const e = err as { message?: string; context?: { message?: string } } | null;
    return e?.message || e?.context?.message || 'Unknown error';
  };

  /** Stamp a participant row as invited so the UI reflects sent status. */
  const markInviteSent = async (participantId: string) => {
    await invokeAdmin('update_participant', { id: participantId, invite_sent_at: new Date().toISOString() });
  };

  // Sends the invite chosen in the post-add dialog, then records sent status.
  const sendWelcomeEmail = async () => {
    if (!pendingParticipant || !selectedSession) return;
    setSendingEmail(true);
    try {
      const { role, email, name } = pendingParticipant;
      await buildAndSendInvite(email, name, role);
      const { data: row } = await supabase
        .from('session_participants')
        .select('id')
        .eq('session_id', selectedSession.id)
        .eq('email', email.toLowerCase())
        .maybeSingle();
      if (row?.id) await markInviteSent(row.id);
      toast.success(`Invitation email queued for ${email}`);
      fetchParticipants(selectedSession.id);
    } catch (err) {
      console.error('Email send failed:', err);
      toast.error(`Email failed: ${errMessage(err)}`, { duration: 15000 });
    } finally {
      setSendingEmail(false);
      setEmailDialogOpen(false);
      setPendingParticipant(null);
    }
  };

  // Send (or resend) the invite to one participant row, updating sent status.
  const sendInviteToParticipant = async (p: ParticipantRow) => {
    if (!selectedSession) return;
    try {
      await buildAndSendInvite(p.email, p.display_name, p.role);
      await markInviteSent(p.id);
      toast.success(`Invitation queued for ${p.email}`);
      fetchParticipants(selectedSession.id);
    } catch (err) {
      toast.error(`Email failed for ${p.email}: ${errMessage(err)}`, { duration: 15000 });
    }
  };

  // Bulk-send invites to everyone not yet emailed. Re-clicking skips anyone
  // already sent (invite_sent_at set), so it never double-emails.
  const sendAllInvites = async () => {
    if (!selectedSession) return;
    const pending = participants.filter(p => p.email && !p.invite_sent_at);
    if (pending.length === 0) {
      toast.info('Everyone has already been emailed. Use the per-row button to resend.');
      return;
    }
    setSendingBulk(true);
    let sent = 0;
    let failed = 0;
    for (const p of pending) {
      try {
        await buildAndSendInvite(p.email, p.display_name, p.role);
        await markInviteSent(p.id);
        sent++;
      } catch (err) {
        console.error('Bulk invite failed for', p.email, err);
        failed++;
      }
    }
    setSendingBulk(false);
    await fetchParticipants(selectedSession.id);
    toast.success(`Queued ${sent} invitation${sent === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}.`, { duration: failed ? 15000 : 6000 });
  };

  // ── CSV bulk-add of participants ────────────────────────────────────────
  const CSV_HEADERS = ['Investor-Emails', 'Startup-Emails', 'Facilitator-Emails'];

  const downloadCsvTemplate = () => {
    const csv = `${CSV_HEADERS.join(',')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'participants-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Minimal CSV parser: handles quoted fields, embedded commas/quotes, CR/LF.
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      if (row.some(v => v.trim() !== '')) rows.push(row);
    }
    return rows;
  };

  const handleBulkCsv = async (file: File) => {
    if (!selectedSession) return;
    setBulkImporting(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) { toast.error('The CSV file is empty.'); return; }

      const header = rows[0].map(h => h.trim().toLowerCase());
      const roleForCol: (string | null)[] = header.map(h => {
        if (h.includes('investor')) return 'investor';
        if (h.includes('start')) return 'startup';
        if (h.includes('facilitator')) return 'facilitator';
        return null;
      });
      if (!roleForCol.some(Boolean)) {
        toast.error('No recognised columns. Use the template: Investor-Emails, Startup-Emails, Facilitator-Emails.', { duration: 15000 });
        return;
      }

      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const seen = new Set<string>();
      const toAdd: { email: string; role: string }[] = [];
      let invalid = 0;
      for (let r = 1; r < rows.length; r++) {
        rows[r].forEach((cell, c) => {
          const role = roleForCol[c];
          const email = cell.trim().toLowerCase();
          if (!role || !email) return;
          if (!emailRe.test(email)) { invalid++; return; }
          const key = `${email}|${role}`;
          if (seen.has(key)) return;
          seen.add(key);
          toAdd.push({ email, role });
        });
      }

      if (toAdd.length === 0) {
        toast.error(`No valid emails found${invalid ? ` (${invalid} invalid skipped)` : ''}.`, { duration: 15000 });
        return;
      }

      const existing = new Set(participants.map(p => p.email.toLowerCase()));
      let added = 0;
      let skipped = 0;
      let failed = 0;
      let nextStartupOrder = (() => {
        const orders = participants
          .filter(p => p.role === 'startup' && p.presentation_order != null)
          .map(p => p.presentation_order!);
        return orders.length > 0 ? Math.max(...orders) + 1 : 1;
      })();

      for (const { email, role } of toAdd) {
        if (existing.has(email)) { skipped++; continue; }
        const { data: result, error } = await invokeAdmin('add_participant', {
          session_id: selectedSession.id,
          email,
          role,
          display_name: null,
          password: null,
          presentation_order: role === 'startup' ? nextStartupOrder : null,
        });
        if (error || result?.error) {
          if (result?.error === 'duplicate') { skipped++; }
          else { failed++; }
          continue;
        }
        existing.add(email);
        if (role === 'startup') nextStartupOrder++;
        added++;
      }

      await fetchParticipants(selectedSession.id);
      const parts = [`Added ${added}`];
      if (skipped) parts.push(`${skipped} already present`);
      if (invalid) parts.push(`${invalid} invalid`);
      if (failed) parts.push(`${failed} failed`);
      toast.success(`Bulk import: ${parts.join(' · ')}.`, { duration: failed || invalid ? 15000 : 8000 });
    } catch (err) {
      console.error('Bulk CSV import failed:', err);
      toast.error(`Bulk import failed: ${errMessage(err)}`, { duration: 15000 });
    } finally {
      setBulkImporting(false);
    }
  };


  const removeParticipant = async (id: string) => {
    const { data, error } = await invokeAdmin('delete_participant', { id });
    if (error || data?.error) {
      toast.error('Failed to remove participant');
      return;
    }
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
      presentation_order: i + 1,
    }));

    await invokeAdmin('bulk_update_participant_order', { updates });

    if (selectedSession) fetchParticipants(selectedSession.id);
  };

  const saveMetadata = async () => {
    if (!metaParticipant) return;
    const { data, error } = await invokeAdmin('update_participant', {
      id: metaParticipant.id,
      dd_room_link: metaDDRoom || null,
      website_link: metaWebsite || null,
      funding_goal: metaFundingGoal ? parseFloat(metaFundingGoal) : null,
    });
    if (error || data?.error) {
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
    setMetaFundingGoal(p.funding_goal != null ? String(p.funding_goal) : '');
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
        <Button variant="ghost" size="sm" onClick={() => { clearAdminToken(); setIsAuthenticated(false); setAdminEmail(''); setAdminPassword(''); }}>
          Sign Out
        </Button>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
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
                <div>
                  <Label htmlFor="timezone">Timezone</Label>
                  <TimezonePicker id="timezone" value={newTimezone} onChange={setNewTimezone} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pick the timezone first — start and end times are set in this zone.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="start-time">Start Time</Label>
                    <TimePicker id="start-time" value={newStartTime} onChange={setNewStartTime} disabled={!newTimezone} />
                  </div>
                  <div>
                    <Label htmlFor="end-time">End Time</Label>
                    <TimePicker id="end-time" value={newEndTime} onChange={setNewEndTime} disabled={!newTimezone} />
                  </div>
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
                    onClick={() => { setSelectedSession(s); fetchParticipants(s.id); fetchChatArchives(s.id); fetchInvestments(s.id); }}
                  >
                    <CardContent className="py-4 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{s.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatDateInTimeZone(s.start_time, s.timezone || 'UTC')}, {formatTimeInTimeZone(s.start_time, s.timezone || 'UTC')} — {formatTimeInTimeZone(s.end_time, s.timezone || 'UTC', true)}
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
                    <CardTitle>
                      {isEditingSession ? 'Edit Session' : selectedSession.name}
                    </CardTitle>
                    <div className="flex gap-2">
                      {!isEditingSession && (
                        <Button size="sm" variant="outline" onClick={startEditingSession}>
                          <Pencil className="w-4 h-4 mr-1" /> Edit
                        </Button>
                      )}
                      {selectedSession.status === 'scheduled' && !isEditingSession && (
                        <Button size="sm" onClick={() => updateSessionStatus(selectedSession.id, 'live')} className="bg-accent text-accent-foreground">
                          <Play className="w-4 h-4 mr-1" /> Go Live
                        </Button>
                      )}
                      {selectedSession.status === 'live' && !isEditingSession && (
                        <Button size="sm" variant="outline" onClick={() => updateSessionStatus(selectedSession.id, 'completed')}>
                          End Session
                        </Button>
                      )}
                      {!isEditingSession && (
                        <Button size="sm" variant="destructive" onClick={() => deleteSession(selectedSession.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {isEditingSession ? (
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="edit-name">Session Name</Label>
                          <Input
                            id="edit-name"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="edit-date">Date</Label>
                            <Input
                              id="edit-date"
                              type="date"
                              value={editDate}
                              onChange={e => setEditDate(e.target.value)}
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label htmlFor="edit-timezone">Timezone</Label>
                            <TimezonePicker id="edit-timezone" value={editTimezone} onChange={setEditTimezone} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="edit-start-time">Start Time</Label>
                            <TimePicker id="edit-start-time" value={editStartTime} onChange={setEditStartTime} disabled={!editTimezone} />
                          </div>
                          <div>
                            <Label htmlFor="edit-end-time">End Time</Label>
                            <TimePicker id="edit-end-time" value={editEndTime} onChange={setEditEndTime} disabled={!editTimezone} />
                          </div>
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            onClick={saveSessionEdits}
                            disabled={savingEdit}
                            className="bg-accent text-accent-foreground hover:bg-accent/90"
                          >
                            <Check className="w-4 h-4 mr-1" /> {savingEdit ? 'Saving…' : 'Save Changes'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEditingSession} disabled={savingEdit}>
                            <X className="w-4 h-4 mr-1" /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          {formatDateInTimeZone(selectedSession.start_time, selectedSession.timezone || 'UTC')}, {formatTimeInTimeZone(selectedSession.start_time, selectedSession.timezone || 'UTC')} — {formatTimeInTimeZone(selectedSession.end_time, selectedSession.timezone || 'UTC', true)}
                        </p>
                        <p className="text-sm text-muted-foreground">Timezone: {selectedSession.timezone}</p>
                      </>
                    )}
                  </CardContent>
                </Card>


                {/* Participants */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" /> Participants
                    </CardTitle>
                    {participants.length > 0 && (() => {
                      const unsentCount = participants.filter(p => p.email && !p.invite_sent_at).length;
                      return (
                        <Button
                          size="sm"
                          onClick={sendAllInvites}
                          disabled={sendingBulk || unsentCount === 0}
                          className="bg-accent text-accent-foreground"
                          title={unsentCount === 0 ? 'Everyone has been emailed' : `Send to ${unsentCount} not yet emailed`}
                        >
                          {sendingBulk
                            ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            : <Send className="w-4 h-4 mr-1" />}
                          {sendingBulk ? 'Sending…' : `Send emails${unsentCount ? ` (${unsentCount})` : ''}`}
                        </Button>
                      );
                    })()}
                  </CardHeader>
                  <CardContent>
                    {/* Bulk add via CSV — top right, above the add inputs */}
                    <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
                      <input
                        ref={csvInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleBulkCsv(file);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => csvInputRef.current?.click()}
                        disabled={bulkImporting}
                      >
                        {bulkImporting
                          ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          : <Upload className="w-4 h-4 mr-1" />}
                        {bulkImporting ? 'Importing…' : 'Bulk add with .csv'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={downloadCsvTemplate}>
                        <Download className="w-4 h-4 mr-1" /> Download .csv template
                      </Button>
                    </div>

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
                            <TableHead>Invite</TableHead>
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
                              <TableCell>
                                {p.invite_sent_at ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"
                                    title={`Sent ${new Date(p.invite_sent_at).toLocaleString()}`}
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Sent
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Not sent</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => sendInviteToParticipant(p)}
                                    disabled={sendingBulk}
                                    title={p.invite_sent_at ? 'Resend invitation' : 'Send invitation'}
                                  >
                                    <Send className="w-3.5 h-3.5" />
                                  </Button>
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
                            <a href={file.url} target="_blank" rel="noopener noreferrer" onClick={externalLinkHandler(file.url)}>
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
              <Label>Funding Goal ($)</Label>
              <Input
                type="number"
                value={metaFundingGoal}
                onChange={e => setMetaFundingGoal(e.target.value)}
                placeholder="125000"
                className="mt-1"
              />
            </div>
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
