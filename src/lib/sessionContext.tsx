import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type UserRole = 'investor' | 'startup' | 'facilitator';

export interface SessionUser {
  /** session_participants.id — required so presence flips don't need a UPDATE policy */
  participantId: string;
  email: string;
  role: UserRole;
  displayName: string;
  sessionId: string;
}

interface SessionContextType {
  user: SessionUser | null;
  setUser: (user: SessionUser | null) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);

  const clearLoginFlag = useCallback(async (u: SessionUser) => {
    // Use the SECURITY DEFINER RPC — session_participants has no UPDATE policy.
    await supabase.rpc('set_participant_presence', {
      _participant_id: u.participantId,
      _logged_in: false,
    });
  }, []);

  const logout = useCallback(async () => {
    if (user) {
      await clearLoginFlag(user);
    }
    setUser(null);
  }, [user, clearLoginFlag]);

  // Best-effort cleanup on tab/browser close — hits the RPC endpoint directly
  // so sendBeacon can fire without depending on the supabase-js runtime.
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!user) return;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/set_participant_presence`;
      const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const body = JSON.stringify({
        _participant_id: user.participantId,
        _logged_in: false,
      });

      // sendBeacon can't set custom headers, so it can't carry the apikey.
      // Fire it as a best-effort backup, then rely on fetch+keepalive for the
      // authenticated request.
      try {
        navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }));
      } catch {/* noop */}

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        keepalive: true,
      }).catch(() => {/* noop */});
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user]);

  return (
    <SessionContext.Provider value={{ user, setUser, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionUser() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSessionUser must be used within SessionProvider');
  return context;
}
