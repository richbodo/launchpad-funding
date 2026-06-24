import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Index from '../Index';
import { SessionProvider, useSessionUser } from '@/lib/sessionContext';
import { useEffect } from 'react';

const renderHome = () =>
  render(
    <SessionProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );

const mockFetch = (events: any[]) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ events }), { status: 200 })) as any,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Index (public home)', () => {
  it('renders upcoming events with links to /event/:slug', async () => {
    mockFetch([
      {
        id: 's1',
        name: 'Spring Demo Day',
        slug: 'spring-demo',
        description: 'Eight startups pitch live.',
        start_time: new Date('2026-04-01T17:00:00Z').toISOString(),
        end_time: new Date('2026-04-01T19:00:00Z').toISOString(),
        timezone: 'UTC',
        status: 'scheduled',
        hero_image_url: null,
      },
    ]);

    renderHome();

    expect(await screen.findByText('Spring Demo Day')).toBeInTheDocument();
    const card = screen.getByTestId('upcoming-event-card');
    expect(card.getAttribute('href')).toBe('/event/spring-demo');
  });

  it('shows an empty state when there are no events', async () => {
    mockFetch([]);
    renderHome();
    expect(await screen.findByText(/No upcoming events right now/i)).toBeInTheDocument();
  });

  it('redirects to /login when a user is already signed in', async () => {
    mockFetch([]);
    const Seed = () => {
      const { setUser } = useSessionUser();
      useEffect(() => {
        setUser({
          participantId: 'p1',
          email: 'x@y.z',
          role: 'investor',
          displayName: 'X',
          sessionId: 's1',
        });
      }, [setUser]);
      return null;
    };
    render(
      <SessionProvider>
        <MemoryRouter initialEntries={['/']}>
          <Seed />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<div>LOGIN PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
    });
  });
});
