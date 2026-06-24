import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import EventLanding from '../EventLanding';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const renderAt = (slug: string) =>
  render(
    <MemoryRouter initialEntries={[`/event/${slug}`]}>
      <Routes>
        <Route path="/event/:slug" element={<EventLanding />} />
      </Routes>
    </MemoryRouter>,
  );

const landingPayload = {
  session: {
    id: 's1',
    name: 'Spring Demo Day',
    description: 'Eight startups pitch live.',
    start_time: new Date('2026-04-01T17:00:00Z').toISOString(),
    end_time: new Date('2026-04-01T19:00:00Z').toISOString(),
    timezone: 'UTC',
    status: 'scheduled',
    slug: 'spring-demo',
    hero_image_url: null,
    max_attendees: 100,
    is_full: false,
  },
  startups: [
    {
      display_name: 'Acme AI',
      image_url: null,
      website_link: 'https://acme.example',
      dd_room_link: null,
      funding_goal: 50000,
    },
  ],
  facilitators: [{ display_name: 'Jane Host', image_url: null }],
  approved_attendee_count: 42,
  accepting_signups: true,
};

const mockFetch = (impl: (url: string, init?: any) => Promise<Response>) => {
  vi.stubGlobal('fetch', vi.fn(impl) as any);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Issue #44: Public /event/:slug page rendering, 404 handling, and
 * self-signup submission flow.
 */
describe('EventLanding page', () => {
  it('renders the event details after loading', async () => {
    mockFetch(async (url) => {
      if (url.includes('event-landing')) {
        return new Response(JSON.stringify(landingPayload), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    renderAt('spring-demo');

    expect(await screen.findByText('Spring Demo Day')).toBeInTheDocument();
    expect(screen.getByText(/Eight startups pitch live/)).toBeInTheDocument();
    expect(screen.getByText('Acme AI')).toBeInTheDocument();
    expect(screen.getByText('Jane Host')).toBeInTheDocument();
    expect(screen.getByText(/42 of 100 seats taken/)).toBeInTheDocument();
    expect(screen.getByTestId('event-signup-form')).toBeInTheDocument();
  });

  it('shows a not-found state for unknown slugs', async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: 'no' }), { status: 404 }));

    renderAt('does-not-exist');

    expect(await screen.findByText('Event not found')).toBeInTheDocument();
    expect(screen.queryByTestId('event-signup-form')).not.toBeInTheDocument();
  });

  it('shows a "session full" message instead of the form when not accepting signups', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ ...landingPayload, accepting_signups: false, session: { ...landingPayload.session, is_full: true } }),
        { status: 200 },
      ),
    );

    renderAt('spring-demo');

    expect(await screen.findByText(/Sorry, the session is full\./)).toBeInTheDocument();
    expect(screen.queryByTestId('event-signup-form')).not.toBeInTheDocument();
  });

  it('submits the signup form and shows the on-the-list confirmation', async () => {
    const calls: any[] = [];
    mockFetch(async (url, init) => {
      if (url.includes('event-landing')) {
        return new Response(JSON.stringify(landingPayload), { status: 200 });
      }
      if (url.includes('event-signup')) {
        calls.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ success: true, already_registered: false, approved: false }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    renderAt('spring-demo');
    await screen.findByTestId('event-signup-form');

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'investor@example.com' } });
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Ivy' } });
    fireEvent.click(screen.getByTestId('event-signup-submit'));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toMatchObject({
      slug: 'spring-demo',
      email: 'investor@example.com',
      display_name: 'Ivy',
      investor_class: 'accredited',
    });
    expect(await screen.findByText("You're on the list")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows the already-registered toast when the API reports a duplicate signup', async () => {
    mockFetch(async (url) => {
      if (url.includes('event-landing')) {
        return new Response(JSON.stringify(landingPayload), { status: 200 });
      }
      return new Response(
        JSON.stringify({ success: true, already_registered: true, approved: false }),
        { status: 200 },
      );
    });

    renderAt('spring-demo');
    await screen.findByTestId('event-signup-form');
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'dup@example.com' } });
    fireEvent.click(screen.getByTestId('event-signup-submit'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('already on the list'));
    });
  });

  it('surfaces a server error toast and stays on the form', async () => {
    mockFetch(async (url) => {
      if (url.includes('event-landing')) {
        return new Response(JSON.stringify(landingPayload), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Sorry, the session is full.' }), { status: 409 });
    });

    renderAt('spring-demo');
    await screen.findByTestId('event-signup-form');
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'late@example.com' } });
    fireEvent.click(screen.getByTestId('event-signup-submit'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Sorry, the session is full.');
    });
    expect(screen.getByTestId('event-signup-form')).toBeInTheDocument();
  });
});
