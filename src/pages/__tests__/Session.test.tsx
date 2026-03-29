import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/test/mocks/livekit';

// --- Supabase mock ---
const mockChannelOn = vi.fn().mockReturnThis();
const mockChannelSubscribe = vi.fn().mockReturnThis();
const mockChannel = {
  on: mockChannelOn,
  subscribe: mockChannelSubscribe,
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'session-1',
                  name: 'Test Session',
                  status: 'live',
                  start_time: new Date().toISOString(),
                  end_time: new Date(Date.now() + 3600000).toISOString(),
                },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'session_participants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((_col: string, _val: string) => ({
              eq: vi.fn((_col2: string, val2: string) => {
                if (val2 === 'startup') {
                  return {
                    order: vi.fn().mockResolvedValue({
                      data: [
                        { email: 'startup-a@test.com', display_name: 'AlphaTech', presentation_order: 1 },
                        { email: 'startup-b@test.com', display_name: 'BetaCorp', presentation_order: 2 },
                      ],
                      error: null,
                    }),
                  };
                }
                // facilitator query — no .order(), resolves directly
                return Promise.resolve({
                  data: [
                    { email: 'facilitator@test.com', display_name: 'Test Facilitator' },
                  ],
                  error: null,
                });
              }),
            })),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      if (table === 'investments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === 'session_logs') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      // Default fallback — support .select().eq().order() chains
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    }),
    channel: vi.fn(() => mockChannel),
    removeChannel: vi.fn(),
  },
}));

// --- Mock sessionContext to inject user synchronously ---
const mockLogout = vi.fn();
let mockUser: any = null;

vi.mock('@/lib/sessionContext', () => ({
  useSessionUser: vi.fn(() => ({
    user: mockUser,
    setUser: vi.fn(),
    logout: mockLogout,
  })),
  SessionProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

// --- LiveKit token mock ---
vi.mock('@/hooks/useLiveKitToken', () => ({
  useLiveKitToken: vi.fn(() => ({
    token: null,
    ws_url: null,
    room: null,
    error: null,
    loading: false,
    fetchToken: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  })),
}));

// --- useDemoMode mock ---
vi.mock('@/hooks/useDemoMode', () => ({
  useDemoMode: vi.fn(() => ({ isDemoMode: false })),
}));

// --- Livekit styles mock ---
vi.mock('@livekit/components-styles', () => ({}));

import SessionPage from '../Session';

function renderSession() {
  return render(
    <MemoryRouter initialEntries={['/session/session-1']}>
      <Routes>
        <Route path="/session/:id" element={<SessionPage />} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Session — facilitator view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      email: 'facilitator@test.com',
      role: 'facilitator',
      displayName: 'Test Facilitator',
      sessionId: 'session-1',
    };
  });

  it('left pane renders facilitator VideoPane', async () => {
    renderSession();
    await waitFor(() => {
      expect(screen.getByText('Test Facilitator')).toBeInTheDocument();
    });
  });

  it('center pane shows intro placeholder at stage 0, startup after advancing', async () => {
    renderSession();
    // At stage 0 (Introduction), center pane shows the stage label, not a startup
    await waitFor(() => {
      // "Introduction" appears in both SessionTimer and center pane
      expect(screen.getAllByText('Introduction').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('Startup Presentation')).not.toBeInTheDocument();

    // Click Next to advance to the first startup's presentation
    const nextBtn = screen.getByTestId('stage-next-btn');
    nextBtn.click();

    await waitFor(() => {
      expect(screen.getAllByText('AlphaTech').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Startup Presentation')).toBeInTheDocument();
  });

  it('stage controls visible: Previous, Play/Pause, Next', async () => {
    renderSession();
    await waitFor(() => {
      expect(screen.getByText('Previous')).toBeInTheDocument();
      expect(screen.getByText('Play')).toBeInTheDocument();
      expect(screen.getByText('Next')).toBeInTheDocument();
    });
  });
});

describe('Session — Take Stage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      email: 'facilitator@test.com',
      role: 'facilitator',
      displayName: 'Test Facilitator',
      sessionId: 'session-1',
    };
  });

  it('Take Stage button is NOT visible when call is not connected', async () => {
    renderSession();
    await waitFor(() => {
      expect(screen.getByText('Test Facilitator')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('take-stage-btn-facilitator@test.com')).not.toBeInTheDocument();
  });

  it('Take Stage button is NOT visible during presentation stage', async () => {
    renderSession();
    await waitFor(() => {
      expect(screen.getByTestId('stage-next-btn')).toBeInTheDocument();
    });
    // Advance to presentation stage
    screen.getByTestId('stage-next-btn').click();
    await waitFor(() => {
      expect(screen.getByText('Startup Presentation')).toBeInTheDocument();
    });
    // Even if we were connected, the button won't appear because we're
    // using the default mock (token=null), so isConnected is false.
    expect(screen.queryByTestId('take-stage-btn-facilitator@test.com')).not.toBeInTheDocument();
  });

  it('center pane shows placeholder during intro with no one on stage', async () => {
    renderSession();
    await waitFor(() => {
      // Center pane should show "Introduction", not a startup name
      const mainPane = screen.getByTestId('main-video-pane');
      expect(mainPane).toHaveTextContent('Introduction');
    });
    expect(screen.queryByText('Startup Presentation')).not.toBeInTheDocument();
  });
});

describe('Session — investor view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      email: 'investor-1@test.com',
      role: 'investor',
      displayName: 'Investor One',
      sessionId: 'session-1',
    };
  });

  it('stage controls NOT visible', async () => {
    renderSession();
    await waitFor(() => {
      expect(screen.getByText('Investor One (investor)')).toBeInTheDocument();
    });
    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  it('"Invest" button visible', async () => {
    renderSession();
    await waitFor(() => {
      expect(screen.getByText('Invest')).toBeInTheDocument();
    });
  });
});

describe('Session — startup view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      email: 'startup-a@test.com',
      role: 'startup',
      displayName: 'AlphaTech',
      sessionId: 'session-1',
    };
  });

  it('stage controls NOT visible', async () => {
    renderSession();
    await waitFor(() => {
      expect(screen.getByText('AlphaTech (startup)')).toBeInTheDocument();
    });
    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });
});
