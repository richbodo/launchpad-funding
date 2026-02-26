import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider } from '@/lib/sessionContext';
import Login from '../Login';

// Mock supabase
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();

let sessionCallCount = 0;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        sessionCallCount++;
        const isFirstCall = sessionCallCount % 2 === 1;
        return {
          select: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: isFirstCall ? [{
                    id: 'session-1',
                    name: 'Test Session',
                    start_time: new Date(Date.now() - 60000).toISOString(),
                    end_time: new Date(Date.now() + 3600000).toISOString(),
                  }] : [],
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'session_participants') {
        return {
          select: mockSelect,
          update: mockUpdate,
        };
      }
      if (table === 'session_logs') {
        return { insert: mockInsert };
      }
      return { select: vi.fn() };
    }),
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

function setupFacilitatorMock(passwordHash: string) {
  mockSelect.mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'p-1',
              email: 'admin@test.com',
              role: 'facilitator',
              display_name: 'Admin',
              password_hash: passwordHash,
              is_logged_in: false,
            },
            error: null,
          }),
        }),
      }),
    }),
  });
}

async function goToPasswordStep() {
  renderLogin();
  await waitFor(() => expect(screen.getByText('Facilitator')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Facilitator'));
  fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'admin@test.com' } });
  fireEvent.click(screen.getByText('Join Session'));
  await waitFor(() => expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument());
}

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionCallCount = 0;
    mockInsert.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it('renders role selection buttons', async () => {
    renderLogin();
    await waitFor(() => {
      expect(screen.getByText('Investor')).toBeInTheDocument();
      expect(screen.getByText('Startup')).toBeInTheDocument();
      expect(screen.getByText('Facilitator')).toBeInTheDocument();
    });
  });

  it('shows password step for facilitator role', async () => {
    setupFacilitatorMock('secret123');
    await goToPasswordStep();
    expect(screen.getByText('Facilitator access')).toBeInTheDocument();
  });

  it('rejects incorrect facilitator password', async () => {
    setupFacilitatorMock('correct_password');
    await goToPasswordStep();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(mockNavigate).not.toHaveBeenCalled());
  });

  it('accepts correct facilitator password and navigates to admin', async () => {
    setupFacilitatorMock('demo123');
    await goToPasswordStep();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'demo123' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin'));
  });

  it('toggles password visibility with eye icon', async () => {
    setupFacilitatorMock('demo123');
    await goToPasswordStep();

    const passwordInput = screen.getByPlaceholderText('Enter your password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    // Click eye icon to show password
    const eyeButton = passwordInput.parentElement?.querySelector('button');
    expect(eyeButton).toBeTruthy();
    fireEvent.click(eyeButton!);
    expect(passwordInput).toHaveAttribute('type', 'text');

    // Click again to hide
    fireEvent.click(eyeButton!);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
