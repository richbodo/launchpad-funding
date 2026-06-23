import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { setAdminToken } from '@/lib/adminAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

/**
 * First-run setup screen for a freshly remixed FundFlow app.
 *
 * Renders on /admin when `bootstrap-first-facilitator` reports zero
 * facilitator accounts exist. Collects email + password + display name,
 * calls the bootstrap edge function, and — on success — stores the
 * returned admin_token and signals the parent Admin page to mark itself
 * authenticated. The edge function refuses any subsequent call once a
 * facilitator exists, so this UI cannot be used to escalate later.
 */
export default function FirstRunSetup({ onComplete }: { onComplete: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      toast.error('Email and password are required');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke('bootstrap-first-facilitator', {
      body: {
        action: 'create',
        email: email.trim().toLowerCase(),
        password,
        display_name: displayName.trim() || null,
      },
    });
    setSubmitting(false);

    if (error || !data?.success || !data?.admin_token) {
      const msg = data?.error || error?.message || 'Bootstrap failed';
      toast.error(msg);
      return;
    }

    setAdminToken(data.admin_token);
    toast.success('Facilitator account created — welcome!');
    onComplete(email.trim().toLowerCase());
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 text-accent mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold">Welcome to FundFlow</h1>
          <p className="text-muted-foreground mt-1">
            Let's create your first facilitator account to get started.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <Label>Email</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@example.com"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label>Display name (optional)</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Doe"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Password</Label>
              <div className="relative mt-1">
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 8 characters"
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
            <div>
              <Label>Confirm password</Label>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type={showPassword ? 'text' : 'password'}
                className="mt-1"
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {submitting ? 'Creating…' : 'Create facilitator account'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              A placeholder "My First Session" is created so you can start adding participants
              right away. Rename, reschedule, or delete it from the admin panel.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
