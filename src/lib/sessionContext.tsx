import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type UserRole = 'investor' | 'startup' | 'facilitator';
export type InvestorClass = 'accredited' | 'community';

export interface SessionUser {
  /** session_participants.id — required so presence flips don't need a UPDATE policy */
  participantId: string;
  email: string;
  role: UserRole;
  displayName: string;
  sessionId: string;
  /**
   * Only meaningful when role === 'investor'. Issue #41: distinguishes
   * accredited investors (equity + gift) from community supporters (gift only).
   */
  investorClass?: InvestorClass;
  /**
   * Server-issued participant session token (minted at login by
   * mint_participant_token_by_password / _by_email). Required by the write
   * RPCs (submit_investment, post_chat_message, log_session_event) so the
   * server can verify the caller instead of trusting a client-supplied email.
   * Optional to keep legacy call sites and tests compiling; write RPCs will
   * gracefully no-op when absent.
   */
  token?: string;
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
    // Presence updates go through the participant-presence edge function.
    // The function requires the participant session token (server verifies
    // it and derives the participant_id server-side) — if we don't have one
    // there's nothing safe to send.
    if (!u.token) return;
    await fetch(presenceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ participant_token: u.token, logged_in: false }),
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
      if (!user || !user.token) return;
      const body = JSON.stringify({
        participant_token: user.token,
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
