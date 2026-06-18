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

  const presenceUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/participant-presence`;
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  const clearLoginFlag = useCallback(async (u: SessionUser) => {
    // Presence updates go through an edge function so the client never
    // needs a SECURITY DEFINER RPC or an UPDATE policy on session_participants.
    await fetch(presenceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ participant_id: u.participantId, logged_in: false }),
    }).catch(() => {/* noop */});
  }, [presenceUrl, apiKey]);

  const logout = useCallback(async () => {
    if (user) {
      await clearLoginFlag(user);
    }
    setUser(null);
  }, [user, clearLoginFlag]);

  // Best-effort cleanup on tab/browser close.
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!user) return;
      const body = JSON.stringify({
        participant_id: user.participantId,
        logged_in: false,
      });

      // sendBeacon can't set custom headers — fire as best-effort backup,
      // then a keepalive fetch with the apikey for the authoritative call.
      try {
        navigator.sendBeacon?.(presenceUrl, new Blob([body], { type: 'application/json' }));
      } catch {/* noop */}

      fetch(presenceUrl, {
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
  }, [user, presenceUrl, apiKey]);


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
