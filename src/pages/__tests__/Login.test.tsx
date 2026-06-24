import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/lib/sessionContext';
import Login from '../Login';

/**
 * Login regression suite.
 *
 * Covers every entry point we expect to work in production:
 *   - manual login as investor (accredited & community), startup, facilitator
 *   - facilitator with no credentials yet (create-password flow)
 *   - facilitator with wrong password
 *   - magic-link auto-login for investor / startup / facilitator
 *   - investor magic-link with no investor_class (forced to pick)
 *   - background presence call hanging must not block navigation (issue #32)
 */

const testSession = {
  id: 'session-1',
  name: 'Test Session',
  start_time: new Date(Date.now() - 60000).toISOString(),
  end_time: new Date(Date.now() + 3600000).toISOString(),
};

// Customizable per-test state
let participantResult: any = { data: null, error: null };
let loginFnResult: any = { data: { success: true }, error: null };
let setPasswordFnResult: any = { data: { success: true }, error: null };
let facilitatorHasPassword = true; // controls rpc('facilitator_has_password')

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        const sessChain: any = {
          select: vi.fn(() => sessChain),
          eq: vi.fn(() => sessChain),
          neq: vi.fn(() => sessChain),
          lte: vi.fn(() => sessChain),
          gte: vi.fn(() => sessChain),
          order: vi.fn(() => sessChain),
          limit: vi.fn(() => Promise.resolve({ data: [testSession], error: null })),
          maybeSingle: vi.fn(() => Promise.resolve({ data: testSession, error: null })),
        };
        return sessChain;
      }
      if (table === 'session_participants') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          not: vi.fn(() => chain),
          limit: vi.fn(() => Promise.resolve({ data: [{ id: 'p-existing' }], error: null })),
          maybeSingle: vi.fn(() => Promise.resolve(participantResult)),
        };
        return {
          ...chain,
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'session_logs') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === 'app_settings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { value: 'production' }, error: null }),
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
    rpc: vi.fn((name: string) => {
      if (name === 'facilitator_has_password') {
        return Promise.resolve({ data: facilitatorHasPassword, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    functions: {
      invoke: vi.fn((fnName: string) => {
        if (fnName === 'participant-set-password') return Promise.resolve(setPasswordFnResult);
        if (fnName === 'participant-presence') return Promise.resolve({ data: { ok: true }, error: null });
        return Promise.resolve(loginFnResult);
      }),
    },
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderLogin(initialPath = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SessionProvider>
        <Login />
      </SessionProvider>
    </MemoryRouter>,
  );
}

function setParticipant(participant: any) {
  participantResult = { data: participant, error: null };
}

async function waitForSession() {
  await waitFor(() =>
    expect(screen.getByTestId('role-btn-facilitator')).not.toBeDisabled(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  participantResult = { data: null, error: null };
  loginFnResult = { data: { success: true }, error: null };
  setPasswordFnResult = { data: { success: true }, error: null };
  facilitatorHasPassword = true;
});

describe('Login Page — manual flows', () => {
  it('renders role selection UI with split investor buttons', async () => {
    renderLogin();
    await waitFor(() => {
      expect(screen.getByTestId('role-btn-investor-accredited')).toBeInTheDocument();
      expect(screen.getByTestId('role-btn-investor-community')).toBeInTheDocument();
      expect(screen.getByTestId('role-btn-startup')).toBeInTheDocument();
      expect(screen.getByTestId('role-btn-facilitator')).toBeInTheDocument();
      expect(screen.getByText('Join session as...')).toBeInTheDocument();
    });
  });

  it('logs in an accredited investor with one click', async () => {
    setParticipant({
      id: 'p-inv',
      email: 'inv@test.com',
      role: 'investor',
      display_name: 'Inv',
      investor_class: 'accredited',
      is_logged_in: false,
    });
    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'inv@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-investor-accredited'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1'),
    );
  });

  it('logs in a community investor with one click', async () => {
    setParticipant({
      id: 'p-inv',
      email: 'comm@test.com',
      role: 'investor',
      display_name: 'Comm',
      investor_class: 'community',
      is_logged_in: false,
    });
    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'comm@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-investor-community'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1'),
    );
  });

  it('sends startup login to the green room', async () => {
    setParticipant({
      id: 'p-startup',
      email: 'founder@test.com',
      role: 'startup',
      display_name: 'Founder',
      is_logged_in: false,
    });
    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'founder@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-startup'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1/ready'),
    );
  });

  it('shows password step for facilitator with existing credentials', async () => {
    facilitatorHasPassword = true;
    setParticipant({
      id: 'p-fac',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      is_logged_in: false,
    });
    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'admin@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-facilitator'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument(),
    );
  });

  it('rejects an incorrect facilitator password', async () => {
    facilitatorHasPassword = true;
    setParticipant({
      id: 'p-fac',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      is_logged_in: false,
    });
    loginFnResult = { data: { success: false, error: 'Invalid credentials' }, error: null };
    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'admin@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-facilitator'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByTestId('password-submit-btn'));
    await waitFor(() => expect(loginFnResult.data.success).toBe(false));
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/session/'));
  });

  it('accepts the correct facilitator password and navigates to the green room', async () => {
    facilitatorHasPassword = true;
    setParticipant({
      id: 'p-fac',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      is_logged_in: false,
    });
    loginFnResult = { data: { success: true, admin_token: 'tok' }, error: null };
    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'admin@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-facilitator'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'correct' },
    });
    fireEvent.click(screen.getByTestId('password-submit-btn'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1/ready'),
    );
  });

  it('routes a credential-less facilitator to the create-password step', async () => {
    facilitatorHasPassword = false;
    setParticipant({
      id: 'p-fac',
      email: 'new@test.com',
      role: 'facilitator',
      display_name: 'New Fac',
      is_logged_in: false,
    });
    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'new@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-facilitator'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('At least 8 characters')).toBeInTheDocument(),
    );
  });

  it('completes the create-password flow and lands on the password step', async () => {
    facilitatorHasPassword = false;
    setParticipant({
      id: 'p-fac',
      email: 'new@test.com',
      role: 'facilitator',
      display_name: 'New Fac',
      is_logged_in: false,
    });
    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'new@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-facilitator'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('At least 8 characters')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
      target: { value: 'longenoughpw' },
    });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), {
      target: { value: 'longenoughpw' },
    });
    fireEvent.click(screen.getByText('Create password'));

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument(),
    );
  });
});

describe('Login Page — magic links', () => {
  it('auto-logs in an investor whose investor_class is already set', async () => {
    setParticipant({
      id: 'p-inv',
      email: 'inv@test.com',
      role: 'investor',
      display_name: 'Inv',
      investor_class: 'accredited',
      is_logged_in: false,
    });
    renderLogin('/login?session=session-1&email=inv@test.com&role=investor');
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1'),
    );
  });

  it('forces an investor with no investor_class to pick before joining', async () => {
    setParticipant({
      id: 'p-inv',
      email: 'inv@test.com',
      role: 'investor',
      display_name: 'Inv',
      investor_class: null,
      is_logged_in: false,
    });
    renderLogin('/login?session=session-1&email=inv@test.com&role=investor');
    await waitFor(() =>
      expect(screen.getByTestId('investor-class-accredited')).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('investor-class-community'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1'),
    );
  });

  it('auto-logs in a startup magic-link to the green room', async () => {
    setParticipant({
      id: 'p-st',
      email: 'founder@test.com',
      role: 'startup',
      display_name: 'Founder',
      is_logged_in: false,
    });
    renderLogin('/login?session=session-1&email=founder@test.com&role=startup');
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1/ready'),
    );
  });

  it('startup magic-link with ?edit=true skips the green room', async () => {
    setParticipant({
      id: 'p-st',
      email: 'founder@test.com',
      role: 'startup',
      display_name: 'Founder',
      is_logged_in: false,
    });
    renderLogin('/login?session=session-1&email=founder@test.com&role=startup&edit=true');
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1?edit=true'),
    );
  });

  it('facilitator magic-link without password routes to the password step', async () => {
    facilitatorHasPassword = true;
    setParticipant({
      id: 'p-fac',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      is_logged_in: false,
    });
    renderLogin('/login?session=session-1&email=admin@test.com&role=facilitator');
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('facilitator magic-link with embedded ?password= auto-logs in', async () => {
    facilitatorHasPassword = true;
    setParticipant({
      id: 'p-fac',
      email: 'admin@test.com',
      role: 'facilitator',
      display_name: 'Admin',
      is_logged_in: false,
    });
    loginFnResult = { data: { success: true, admin_token: 'tok' }, error: null };
    renderLogin('/login?session=session-1&email=admin@test.com&role=facilitator&password=demo123');
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/session/session-1/ready'),
    );
  });

  // Regression: a hanging participant-presence call must not block navigation.
  it('navigates even when participant-presence hangs (issue #32)', async () => {
    setParticipant({
      id: 'p-inv',
      email: 'inv@test.com',
      role: 'investor',
      display_name: 'Inv',
      investor_class: 'accredited',
      is_logged_in: false,
    });
    const { supabase } = await import('@/integrations/supabase/client');
    (supabase.functions.invoke as any).mockImplementation((name: string) => {
      if (name === 'participant-presence') return new Promise(() => {}); // hangs
      return Promise.resolve({ data: { success: true }, error: null });
    });

    renderLogin();
    await waitForSession();
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'inv@test.com' },
    });
    fireEvent.click(screen.getByTestId('role-btn-investor-accredited'));
    await waitFor(
      () => expect(mockNavigate).toHaveBeenCalledWith('/session/session-1'),
      { timeout: 1500 },
    );
  });
});
