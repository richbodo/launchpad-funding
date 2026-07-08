import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser, UserRole, InvestorClass } from '@/lib/sessionContext';
import { useDemoMode } from '@/hooks/useDemoMode';
import { setAdminToken } from '@/lib/adminAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, Users, Briefcase, ArrowRight, TrendingUp, Lock, Eye, EyeOff, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import DemoModeBanner from '@/components/DemoModeBanner';

interface ActiveSession {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
}

type Step = 'login' | 'facilitator-password' | 'facilitator-create-password' | 'investor-class-select';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useSessionUser();
  const { isDemoMode } = useDemoMode();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  // Issue #41: investors choose a class (accredited vs community supporter)
  // before submitting. Defaults to 'accredited' so existing behavior is
  // preserved for users who don't think about it.
  const [investorClass, setInvestorClass] = useState<InvestorClass>('accredited');
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('login');
  const [pendingParticipant, setPendingParticipant] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const autoLoginAttempted = useRef(false);

  /**
   * Returns true when this facilitator email has no credentials row anywhere —
   * i.e. this is their very first facilitator invite and they need to create a
   * password before logging in. Uses a SECURITY DEFINER RPC because the
   * password_hash column is no longer exposed to the client.
   */
  const facilitatorNeedsPassword = async (facilitatorEmail: string): Promise<boolean> => {
    const { data } = await supabase.rpc('facilitator_has_password', {
      _email: facilitatorEmail.toLowerCase(),
    });
    return data !== true;
  };

  const handleCreatePassword = async () => {
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('participant-set-password', {
        body: {
          session_id: selectedSession,
          email: pendingParticipant.email,
          password: newPassword,
        },
      });
      if (error || !data?.success) {
        toast.error(data?.error || 'Could not set password');
        setLoading(false);
        return;
      }
      // Prefill the password for the standard facilitator login step so the
      // user just clicks Continue and lands in the session.
      setPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setStep('facilitator-password');
      toast.success('Password set — please log in to continue.');
    } catch {
      toast.error('Could not set password');
    }
    setLoading(false);
  };

  const handleRandomize = async (targetRole: UserRole) => {
    if (!selectedSession) return;
    setLoading(true);
    try {
      const { data: available } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', selectedSession)
        .eq('role', targetRole)
        .eq('is_logged_in', false);

      if (!available || available.length === 0) {
        toast.error(`No available ${targetRole}s to log in as.`);
        setLoading(false);
        return;
      }

      const pick = available[Math.floor(Math.random() * available.length)];
      setEmail(pick.email);
      setRole(targetRole);

      if (targetRole === 'facilitator') {
        setPendingParticipant(pick);
        setStep('facilitator-password');
        setLoading(false);
        return;
      }

      await completeLoginWith(pick, targetRole);
    } catch {
      toast.error('Randomize failed.');
    }
    setLoading(false);
  };

  const completeLoginWith = async (participant: any, loginRole: UserRole) => {
    // Resolve the investor class from the seeded participant row when
    // available — magic-link / auto-login paths don't use the local picker
    // state, so a community supporter clicking "Jump in" on /demo-logins
    // would otherwise be silently treated as accredited (issue surfaced
    // when adding per-investor-class auto-login shortcuts).
    const resolvedClass: InvestorClass | undefined =
      loginRole === 'investor'
        ? ((participant.investor_class as InvestorClass | null) ?? investorClass)
        : undefined;

    // Mint a server-side participant session token so subsequent write RPCs
    // (submit_investment / post_chat_message / log_session_event) can verify
    // the caller instead of trusting a client-supplied email. Facilitators
    // reach this helper only via the demo Shuffle path; production
    // facilitator auth goes through completeLogin() after password check.
    const token = await mintTokenByEmail(participant.email, loginRole);

    // Set user + navigate IMMEDIATELY so the magic-link recipient lands in the
    // session without waiting on edge-function cold starts. Presence + audit
    // log are fire-and-forget — a slow or failing background call must never
    // strand the user on the "Joining…" screen.
    setUser({
      participantId: participant.id,
      email: participant.email,
      role: loginRole,
      displayName: participant.display_name || participant.email.split('@')[0],
      sessionId: selectedSession,
      investorClass: resolvedClass,
      token: token ?? undefined,
    });

    const editParam = searchParams.get('edit') === 'true' ? '?edit=true' : '';
    // Startups and facilitators land in the Green Room first so they can
    // finish their profile (image, bio/description, links) before entering
    // the live session. Investors and the explicit ?edit=true admin flow
    // skip the Green Room and go straight to the session UI.
    const needsGreenRoom = (loginRole === 'startup' || loginRole === 'facilitator') && !editParam;
    navigate(needsGreenRoom ? `/session/${selectedSession}/ready` : `/session/${selectedSession}${editParam}`);

    // Background side effects — failures are logged but don't block entry.
    supabase.functions.invoke('participant-presence', {
      body: { participant_id: participant.id, logged_in: true },
    }).catch((e) => console.warn('presence update failed', e));

    if (token) {
      supabase.rpc('log_session_event', {
        _token: token,
        _event_type: 'login',
        _event_data: { role: loginRole, investor_class: resolvedClass ?? null },
      }).then(({ error }) => { if (error) console.warn('session_logs rpc failed', error); });
    }
  };

  /**
   * Mint a participant session token for passwordless roles (investor /
   * startup). Facilitators must use mintTokenByPassword instead.
   * Returns null on failure — callers proceed without a token and write RPCs
   * will surface an "Invalid or expired session" error to the user.
   */
  const mintTokenByEmail = async (participantEmail: string, loginRole: UserRole): Promise<string | null> => {
    if (loginRole === 'facilitator') return null;
    try {
      const { data } = await supabase.rpc('mint_participant_token_by_email', {
        _session_id: selectedSession,
        _email: participantEmail,
        _role: loginRole,
      });
      return (data as string | null) ?? null;
    } catch (e) {
      console.warn('mint_participant_token_by_email failed', e);
      return null;
    }
  };

  /**
   * Mint a participant session token by verifying the participant's password
   * server-side. Used by the facilitator login path (and any future
   * password-protected role).
   */
  const mintTokenByPassword = async (participantEmail: string, participantPassword: string): Promise<string | null> => {
    try {
      const { data } = await supabase.rpc('mint_participant_token_by_password', {
        _session_id: selectedSession,
        _email: participantEmail,
        _password: participantPassword,
      });
      return (data as string | null) ?? null;
    } catch (e) {
      console.warn('mint_participant_token_by_password failed', e);
      return null;
    }
  };



  useEffect(() => {
    const fetchSessions = async () => {
      // If the URL targets a specific session (magic-link invite), prefer it
      // over the generic "live / next scheduled" lookup. This guarantees the
      // recipient lands on the session the email was actually about.
      const urlSessionId = searchParams.get('session');
      if (urlSessionId) {
        const { data } = await supabase
          .from('sessions')
          .select('id, name, start_time, end_time')
          .eq('id', urlSessionId)
          .maybeSingle();
        if (data) {
          setActiveSessions([data]);
          setSelectedSession(data.id);
          return;
        }
      }

      // Otherwise fall back to any live session
      const { data } = await supabase
        .from('sessions')
        .select('id, name, start_time, end_time')
        .eq('status', 'live')
        .order('start_time', { ascending: true })
        .limit(1);

      if (data && data.length > 0) {
        setActiveSessions(data);
        setSelectedSession(data[0].id);
        return;
      }

      // Fallback: any session whose scheduled window contains "now",
      // regardless of status. This covers the case where a facilitator
      // forgot to flip status to "live" or the session got auto-marked
      // "completed" but is still meant to be running — they need to be
      // able to log in and reopen it from the admin panel.
      const nowIso = new Date().toISOString();
      const { data: inWindow } = await supabase
        .from('sessions')
        .select('id, name, start_time, end_time')
        .neq('status', 'draft')
        .lte('start_time', nowIso)
        .gte('end_time', nowIso)
        .order('start_time', { ascending: true })
        .limit(1);

      if (inWindow && inWindow.length > 0) {
        setActiveSessions(inWindow);
        setSelectedSession(inWindow[0].id);
        return;
      }

      // Fallback: next scheduled session
      const { data: upcoming } = await supabase
        .from('sessions')
        .select('id, name, start_time, end_time')
        .eq('status', 'scheduled')
        .order('start_time', { ascending: true })
        .limit(1);

      if (upcoming && upcoming.length > 0) {
        setActiveSessions(upcoming);
        setSelectedSession(upcoming[0].id);
      } else {
        setActiveSessions([]);
      }
    };
    fetchSessions();
  }, [searchParams]);

  /**
   * Magic-link auto-login.
   *
   * Triggered when the invite email URL carries `session`, `email`, and `role`
   * params (or the legacy demo-mode `autoLogin=true` flag). Investors and
   * startups are logged in directly — no role picker, no password. Facilitators
   * are pre-filled and routed to the password step, since admin/facilitator
   * access always requires the facilitator password.
   */
  useEffect(() => {
    if (autoLoginAttempted.current) return;
    if (!selectedSession) return;

    const urlEmail = searchParams.get('email');
    const urlRole = searchParams.get('role') as UserRole | null;
    const isDemoAutoLogin = searchParams.get('autoLogin') === 'true';
    const isMagicLink = !!(searchParams.get('session') && urlEmail && urlRole);

    if (!isMagicLink && !(isDemoAutoLogin && urlRole && isDemoMode)) return;
    autoLoginAttempted.current = true;

    const doAutoLogin = async () => {
      try {
        let participant: any = null;
        const normalizedRole = (urlRole?.toLowerCase() as UserRole | null) ?? null;

        if (urlEmail && normalizedRole) {
          const { data } = await supabase
            .from('session_participants')
            .select('*')
            .eq('session_id', selectedSession)
            .eq('email', urlEmail.toLowerCase())
            .eq('role', normalizedRole)
            .maybeSingle();
          participant = data;
        } else if (isDemoAutoLogin && normalizedRole) {
          // Demo-mode randomized auto-login (no email specified)
          const { data: available } = await supabase
            .from('session_participants')
            .select('*')
            .eq('session_id', selectedSession)
            .eq('role', normalizedRole)
            .eq('is_logged_in', false);
          if (available && available.length > 0) {
            participant = available[Math.floor(Math.random() * available.length)];
          }
        }

        if (!participant) {
          toast.error('This invitation link is no longer valid for this session.');
          autoLoginAttempted.current = false;
          return;
        }

        // Facilitator access always requires a real password handshake — no
        // demo-mode bypass. The /demo-logins jump-in URL supplies the demo
        // password via the `password` query param so the handshake can run
        // without a manual prompt; magic-link emails omit it and the user is
        // routed to the password step instead.
        if (normalizedRole === 'facilitator') {
          const urlPassword = searchParams.get('password');
          if (urlPassword) {
            const { data: loginData, error: loginErr } = await supabase.functions.invoke('participant-login', {
              body: {
                session_id: selectedSession,
                email: participant.email,
                password: urlPassword,
              },
            });
            if (loginErr || !loginData?.success) {
              toast.error(loginData?.error || 'Auto-login failed: invalid demo password');
              autoLoginAttempted.current = false;
              return;
            }
            if (loginData.admin_token) setAdminToken(loginData.admin_token);
            await completeLoginWith(participant, 'facilitator');
            return;
          }
          setEmail(participant.email);
          setRole('facilitator');
          setPendingParticipant(participant);
          setStep(await facilitatorNeedsPassword(participant.email)
            ? 'facilitator-create-password'
            : 'facilitator-password');
          return;
        }

        // Investors arriving via a magic link MUST declare their class before
        // entering the session, unless an admin already set it on the row.
        // The class drives which pledge UI they see (equity vs gift-only).
        if (normalizedRole === 'investor' && !participant.investor_class) {
          setEmail(participant.email);
          setRole('investor');
          setPendingParticipant(participant);
          setStep('investor-class-select');
          return;
        }

        await completeLoginWith(participant, normalizedRole!);
      } catch (err) {
        console.error('auto-login failed', err);
        toast.error('Could not auto-join the session. Please sign in below.');
        autoLoginAttempted.current = false;
      }
    };
    doAutoLogin();

  }, [isDemoMode, selectedSession, searchParams]);


  const handleEmailSubmitWithRole = async (selectedRole: UserRole) => {
    if (!email || !selectedSession) {
      toast.error('Please enter your email address');
      return;
    }
    setLoading(true);

    try {
      const { data: participant, error } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', selectedSession)
        .eq('email', email.toLowerCase())
        .eq('role', selectedRole)
        .maybeSingle();

      if (error || !participant) {
        toast.error('You are not registered for this session with this role.');
        setLoading(false);
        return;
      }

      // If already logged in, auto-resume instead of blocking
      if (participant.is_logged_in) {
        toast.info('Resuming your existing session...');
      }

      // Facilitators ALWAYS need to enter a password — including in demo
      // mode, since admin mutations require a real admin_token now.
      if (selectedRole === 'facilitator') {
        setPendingParticipant(participant);
        setStep(await facilitatorNeedsPassword(participant.email)
          ? 'facilitator-create-password'
          : 'facilitator-password');
        setLoading(false);
        return;
      }

      // For investors/startups, log in directly
      await completeLogin(participant, selectedRole);
    } catch (err) {
      toast.error('Login failed. Please try again.');
    }
    setLoading(false);
  };

  const handlePasswordSubmit = async () => {
    if (!password) {
      toast.error('Password is required');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('participant-login', {
        body: {
          session_id: selectedSession,
          email: pendingParticipant.email,
          password,
        },
      });
      if (error || !data?.success) {
        toast.error(data?.error || 'Incorrect password');
        setLoading(false);
        return;
      }
      // Facilitator login: stash the short-lived admin bearer so the Admin
      // panel can authorize its mutation calls without re-prompting.
      if (data.admin_token) setAdminToken(data.admin_token);
      await completeLogin(pendingParticipant, role!);
    } catch (err) {
      toast.error('Login failed. Please try again.');
    }
    setLoading(false);
  };

  const completeLogin = async (participant: any, loginRole?: UserRole) => {
    const resolvedRole = loginRole || role!;
    // Investors who logged in via the email form picked their class with the
    // class buttons, but auto-login flows (magic link / demo "Jump in") set
    // the participant directly. Prefer the row-level class when set, fall
    // back to the picker state otherwise.
    const resolvedClass: InvestorClass | undefined =
      resolvedRole === 'investor'
        ? ((participant.investor_class as InvestorClass | null) ?? investorClass)
        : undefined;

    // Mint a participant session token so all subsequent write RPCs can
    // verify the caller server-side. Facilitators get one via password;
    // investors/startups via email (matching current passwordless flow).
    const token = resolvedRole === 'facilitator'
      ? await mintTokenByPassword(participant.email, password)
      : await mintTokenByEmail(participant.email, resolvedRole);

    // Navigate immediately; side effects run in the background so a slow
    // edge function never traps the user on the login screen.
    setUser({
      participantId: participant.id,
      email: email.toLowerCase(),
      role: resolvedRole,
      displayName: participant.display_name || email.split('@')[0],
      sessionId: selectedSession,
      investorClass: resolvedClass,
      token: token ?? undefined,
    });

    const editParam = searchParams.get('edit') === 'true' ? '?edit=true' : '';
    // See completeLoginWith for the Green Room redirect rationale.
    const needsGreenRoom = (resolvedRole === 'startup' || resolvedRole === 'facilitator') && !editParam;
    navigate(needsGreenRoom ? `/session/${selectedSession}/ready` : `/session/${selectedSession}${editParam}`);

    supabase.functions.invoke('participant-presence', {
      body: { participant_id: participant.id, logged_in: true },
    }).catch((e) => console.warn('presence update failed', e));

    if (token) {
      supabase.rpc('log_session_event', {
        _token: token,
        _event_type: 'login',
        _event_data: { role: resolvedRole, investor_class: resolvedClass ?? null },
      }).then(({ error }) => { if (error) console.warn('session_logs rpc failed', error); });
    }
  };



  const roles: { value: UserRole; label: string; icon: React.ReactNode; desc: string }[] = [
    { value: 'investor', label: 'Investor', icon: <Briefcase className="w-5 h-5" />, desc: 'View pitches & invest' },
    { value: 'startup', label: 'Startup', icon: <Rocket className="w-5 h-5" />, desc: 'Present your company' },
    { value: 'facilitator', label: 'Facilitator', icon: <Users className="w-5 h-5" />, desc: 'Manage the session' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <DemoModeBanner />
      <div className="flex-1 flex items-center justify-center p-4">
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
          <AnimatePresence mode="wait">
            {step === 'login' ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5"
              >
                {activeSessions.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No active sessions right now.</p>
                    <Button variant="outline" className="mt-4" onClick={() => navigate('/admin')}>
                      Facilitator Admin
                    </Button>
                  </div>
                ) : (
                  <>
                    {activeSessions.length === 1 && (
                      <div className="text-center pb-2">
                        <p className="text-sm text-muted-foreground">Joining</p>
                        <p className="font-semibold text-lg" data-testid="session-name">{activeSessions[0].name}</p>
                      </div>
                    )}

                    {/* Email */}
                    <div>
                      <Label htmlFor="email">Email Address <span className="text-muted-foreground font-normal">(required)</span></Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        className="mt-1.5"
                      />
                    </div>

                    {/* Role selection — acts as submit.
                        Investor is split into two buttons (Accredited /
                        Community) so the class choice and the login click
                        are the same gesture. The previous design had a
                        single "Investor" button plus a separate class
                        picker below; users clicking the class buttons
                        expected to log in but those buttons only set
                        state and nothing happened. */}
                    <div>
                      <Label className="mb-2 block">Join session as...</Label>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <button
                          data-testid="role-btn-investor-accredited"
                          disabled={loading || !email}
                          onClick={() => {
                            setRole('investor');
                            setInvestorClass('accredited');
                            handleEmailSubmitWithRole('investor');
                          }}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center disabled:opacity-40 disabled:cursor-not-allowed ${
                            role === 'investor' && investorClass === 'accredited'
                              ? 'border-accent bg-accent/5'
                              : 'border-border hover:border-muted-foreground/30'
                          }`}
                        >
                          <Briefcase className={`w-5 h-5 ${role === 'investor' && investorClass === 'accredited' ? 'text-accent' : 'text-muted-foreground'}`} />
                          <span className="text-xs font-semibold">Accredited Investor</span>
                          <span className="text-[10px] text-muted-foreground">Equity + gift pledges</span>
                        </button>
                        <button
                          data-testid="role-btn-investor-community"
                          disabled={loading || !email}
                          onClick={() => {
                            setRole('investor');
                            setInvestorClass('community');
                            handleEmailSubmitWithRole('investor');
                          }}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center disabled:opacity-40 disabled:cursor-not-allowed ${
                            role === 'investor' && investorClass === 'community'
                              ? 'border-accent bg-accent/5'
                              : 'border-border hover:border-muted-foreground/30'
                          }`}
                        >
                          <Briefcase className={`w-5 h-5 ${role === 'investor' && investorClass === 'community' ? 'text-accent' : 'text-muted-foreground'}`} />
                          <span className="text-xs font-semibold">Community Supporter</span>
                          <span className="text-[10px] text-muted-foreground">Gift pledges only (max $100)</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {roles.filter(r => r.value !== 'investor').map(r => (
                          <div key={r.value} className="flex flex-col items-center">
                            <button
                              data-testid={`role-btn-${r.value}`}
                              disabled={loading || !email}
                              onClick={() => { setRole(r.value); handleEmailSubmitWithRole(r.value); }}
                              className={`w-full flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center disabled:opacity-40 disabled:cursor-not-allowed ${
                                role === r.value
                                  ? 'border-accent bg-accent/5'
                                  : 'border-border hover:border-muted-foreground/30'
                              }`}
                            >
                              <span className={role === r.value ? 'text-accent' : 'text-muted-foreground'}>{r.icon}</span>
                              <span className="text-xs font-medium">{r.label}</span>
                            </button>
                            {isDemoMode && (
                              <button
                                disabled={loading}
                                onClick={() => handleRandomize(r.value)}
                                className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-accent transition-colors disabled:opacity-40"
                              >
                                <Shuffle className="w-3 h-3" />
                                randomize
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {isDemoMode && (
                        <button
                          disabled={loading}
                          onClick={() => handleRandomize('investor')}
                          className="mt-2 mx-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-accent transition-colors disabled:opacity-40"
                        >
                          <Shuffle className="w-3 h-3" />
                          randomize investor
                        </button>
                      )}
                    </div>
                  </>
                )}
              </motion.div>
            ) : step === 'facilitator-create-password' ? (
              <motion.div
                key="create-password"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-5"
              >
                <div className="text-center pb-2">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-3">
                    <Lock className="w-6 h-6 text-accent" />
                  </div>
                  <p className="text-sm text-muted-foreground">Set your facilitator password</p>
                  <p className="font-semibold">{email}</p>
                  {activeSessions.length === 1 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      for <span className="font-medium">{activeSessions[0].name}</span>
                    </p>
                  )}
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Welcome! Facilitators need a password to sign in. Choose one now —
                  you'll use it every time you log in.
                </p>

                <div>
                  <Label htmlFor="newPassword">New password</Label>
                  <Input
                    id="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoFocus
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="mt-1.5"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                  />
                  Show password
                </label>

                <Button
                  onClick={handleCreatePassword}
                  disabled={loading || !newPassword || !confirmPassword}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
                >
                  {loading ? 'Saving...' : 'Create password'}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </motion.div>
            ) : step === 'investor-class-select' ? (
              <motion.div
                key="investor-class"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-5"
              >
                <div className="text-center pb-2">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-3">
                    <Briefcase className="w-6 h-6 text-accent" />
                  </div>
                  <p className="text-sm text-muted-foreground">Before you join</p>
                  <p className="font-semibold">{email}</p>
                  {activeSessions.length === 1 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      for <span className="font-medium">{activeSessions[0].name}</span>
                    </p>
                  )}
                </div>

                <p className="text-sm text-center text-muted-foreground">
                  Please tell us which type of investor you are. This determines
                  whether you can place equity commitments or gift pledges.
                </p>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    data-testid="investor-class-accredited"
                    disabled={loading}
                    onClick={async () => {
                      setInvestorClass('accredited');
                      setLoading(true);
                      await completeLoginWith(
                        { ...pendingParticipant, investor_class: 'accredited' },
                        'investor',
                      );
                    }}
                    className="flex flex-col items-start gap-1 p-4 rounded-lg border-2 border-border hover:border-accent transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-sm font-semibold">Accredited Investor</span>
                    <span className="text-xs text-muted-foreground">
                      Equity commitments + gift pledges
                    </span>
                  </button>
                  <button
                    data-testid="investor-class-community"
                    disabled={loading}
                    onClick={async () => {
                      setInvestorClass('community');
                      setLoading(true);
                      await completeLoginWith(
                        { ...pendingParticipant, investor_class: 'community' },
                        'investor',
                      );
                    }}
                    className="flex flex-col items-start gap-1 p-4 rounded-lg border-2 border-border hover:border-accent transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-sm font-semibold">Community Supporter</span>
                    <span className="text-xs text-muted-foreground">
                      Gift pledges only (max $100)
                    </span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="password"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-5"
              >
                <div className="text-center pb-2">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-3">
                    <Lock className="w-6 h-6 text-accent" />
                  </div>
                  <p className="text-sm text-muted-foreground">Facilitator access</p>
                  <p className="font-semibold">{email}</p>
                  {activeSessions.length === 1 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      for <span className="font-medium">{activeSessions[0].name}</span>
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="password">Password</Label>
                  <div className="relative mt-1.5">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoFocus
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => { setStep('login'); setPassword(''); setPendingParticipant(null); }}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    data-testid="password-submit-btn"
                    onClick={handlePasswordSubmit}
                    disabled={loading || !password}
                    className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
                  >
                    {loading ? 'Verifying...' : 'Continue'}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          <button onClick={() => navigate('/admin')} className="hover:text-foreground underline-offset-2 hover:underline">
            Facilitator Admin →
          </button>
        </p>
      </motion.div>
      </div>
    </div>
  );
}
