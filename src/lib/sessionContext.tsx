import React, { createContext, useContext, useState, ReactNode } from 'react';

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

  const logout = () => setUser(null);

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
