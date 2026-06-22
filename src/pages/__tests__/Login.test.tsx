import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider } from '@/lib/sessionContext';
import Login from '../Login';

const testSession = {
  id: 'session-1',
  name: 'Test Session',
  start_time: new Date(Date.now() - 60000).toISOString(),
  end_time: new Date(Date.now() + 3600000).toISOString(),
};

// Tracks the mock for participant lookup so individual tests can customize it
let participantResult: any = { data: null, error: null };

// Track the mock for supabase.functions.invoke so tests can customize it
let loginFnResult: any = { data: { success: true }, error: null };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [testSession],
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'session_participants') {
        // Chainable query stub: supports both
        //   .select().eq().eq().eq().maybeSingle()  (role-scoped lookup)
        //   .select().eq().eq().not().limit().maybeSingle?()  (facilitatorNeedsPassword)
        // Returns `participantResult` from maybeSingle(); returns a non-empty
        // array from limit() so facilitatorNeedsPassword() reports "has password".
        const chain: any = {
          eq: vi.fn(() => chain),
          not: vi.fn(() => chain),
          limit: vi.fn(() => Promise.resolve({ data: [{ id: 'p-existing' }], error: null })),
          maybeSingle: vi.fn(() => Promise.resolve(participantResult)),
          then: undefined,
        };
        return {
          select: vi.fn(() => chain),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      if (table === 'session_logs') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'app_settings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { value: 'production' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    }),
    functions: {
      invoke: vi.fn().mockImplementation(() => Promise.resolve(loginFnResult)),
    },
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderLogin() {
  return render(
    <BrowserRouter>
      <SessionProvider>
        <Login />
      </SessionProvider>
    </BrowserRouter>
  );
}

function setParticipantMock(participant: any) {
  participantResult = { data: participant, error: null };
}

async function enterEmailAndClickRole(roleName: string) {
  renderLogin();
  await waitFor(() => expect(screen.getByText(roleName)).toBeInTheDocument());
  fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
    target: { value: 'admin@test.com' },
  });
  fireEvent.click(screen.getByText(roleName));
}

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    participantResult = { data: null, error: null };
    loginFnResult = { data: { success: true }, error: null };
  });

  it('renders role selection buttons with "Join session as..." label', async () => {
    renderLogin();
    await waitFor(() => {
      expect(screen.getByText('Investor')).toBeInTheDocument();
      expect(screen.getByText('Startup')).toBeInTheDocument();
      expect(screen.getByText('Facilitator')).toBeInTheDocument();
      expect(screen.getByText('Join session as...')).toBeInTheDocument();
    });
  });

  it('shows email field with (required) label', async () => {
    renderLogin();
    await waitFor(() => {
      expect(screen.getByText('(required)')).toBeInTheDocument();
    });
  });

  it('shows password step for facilitator role', async () => {
    setParticipantMock({
      id: 'p-1',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      password_hash: 'secret123',
      is_logged_in: false,
    });
    await enterEmailAndClickRole('Facilitator');
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument()
    );
  });

  it('rejects incorrect facilitator password', async () => {
    setParticipantMock({
      id: 'p-1',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      password_hash: 'correct_password',
      is_logged_in: false,
    });
    // Server-side verification returns failure
    loginFnResult = { data: { success: false, error: 'Invalid credentials' }, error: null };
    await enterEmailAndClickRole('Facilitator');
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(mockNavigate).not.toHaveBeenCalled());
  });

  it('accepts correct facilitator password and navigates to session', async () => {
    setParticipantMock({
      id: 'p-1',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      password_hash: 'demo123',
      is_logged_in: false,
    });
    await enterEmailAndClickRole('Facilitator');
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'demo123' },
    });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1')
    );
  });

  it('toggles password visibility with eye icon', async () => {
    setParticipantMock({
      id: 'p-1',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      password_hash: 'demo123',
      is_logged_in: false,
    });
    await enterEmailAndClickRole('Facilitator');
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument()
    );

    const passwordInput = screen.getByPlaceholderText('Enter your password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    const eyeButton = passwordInput.parentElement?.querySelector('button');
    fireEvent.click(eyeButton!);
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(eyeButton!);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  // Regression test for GitHub issue #32 — "Magic-link login unreliable on first
  // attempt". A slow/hanging participant-presence edge call used to strand users
  // on the "Joining…" screen. completeLogin must navigate BEFORE awaiting any
  // background side-effects so first-click magic links always land in-session.
  it('navigates to session even when participant-presence call hangs (issue #32)', async () => {
    setParticipantMock({
      id: 'p-99',
      email: 'investor@test.com',
      role: 'investor',
      display_name: 'Investor',
      is_logged_in: false,
    });
    // Simulate a hanging edge function — never resolves.
    const { supabase } = await import('@/integrations/supabase/client');
    (supabase.functions.invoke as any).mockImplementation(
      () => new Promise(() => {})
    );

    renderLogin();
    await waitFor(() => expect(screen.getByText('Investor')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'investor@test.com' },
    });
    fireEvent.click(screen.getByText('Investor'));

    // Navigate must fire even though the background presence call never resolves.
    await waitFor(
      () => expect(mockNavigate).toHaveBeenCalledWith('/session/session-1'),
      { timeout: 1500 }
    );
  });
});
