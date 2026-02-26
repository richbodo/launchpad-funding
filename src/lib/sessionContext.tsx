import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type UserRole = 'investor' | 'startup' | 'facilitator';

export interface SessionUser {
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
    await supabase
      .from('session_participants')
      .update({ is_logged_in: false })
      .eq('session_id', u.sessionId)
      .eq('email', u.email);
  }, []);

  const logout = useCallback(async () => {
    if (user) {
      await clearLoginFlag(user);
    }
    setUser(null);
  }, [user, clearLoginFlag]);

  // Best-effort cleanup on tab/browser close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (user) {
        // Use sendBeacon for reliability during page unload
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/session_participants?session_id=eq.${user.sessionId}&email=eq.${encodeURIComponent(user.email)}`;
        const body = JSON.stringify({ is_logged_in: false });
        navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }));
        // sendBeacon won't include auth headers, so also try fetch with keepalive
        fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'Prefer': 'return=minimal',
          },
          body,
          keepalive: true,
        }).catch(() => {});
      }
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
