import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import EventLandingAdminCard from '../EventLandingAdminCard';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

vi.mock('@/lib/adminAuth', () => ({
  getAdminToken: () => 'admin-token',
}));

// ImageUploadField is exercised in its own test — stub it to a simple input here.
vi.mock('@/components/ImageUploadField', () => ({
  __esModule: true,
  default: ({ value, onChange, label }: any) => (
    <label>
      {label}
      <input
        data-testid="hero-image-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  ),
}));

import { supabase } from '@/integrations/supabase/client';

const baseSession = {
  id: 'sess-1',
  name: 'Spring Demo',
  slug: 'spring-demo',
  description: 'Eight startups pitch live.',
  hero_image_url: '',
  max_attendees: 100,
  is_full: false,
};

const renderCard = (overrides: Partial<typeof baseSession> = {}, participants: any[] = []) => {
  const onUpdated = vi.fn();
  const onApprove = vi.fn().mockResolvedValue(undefined);
  const onReject = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <EventLandingAdminCard
      session={{ ...baseSession, ...overrides }}
      participants={participants}
      onUpdated={onUpdated}
      onApproveParticipant={onApprove}
      onRejectParticipant={onReject}
    />,
  );
  return { ...utils, onUpdated, onApprove, onReject };
};

/**
 * Issue #44: Admin card lets facilitators configure the public landing
 * page and approve/reject self-signups.
 */
describe('EventLandingAdminCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the public URL built from the slug', () => {
    renderCard();
    const url = screen.getByDisplayValue(/\/event\/spring-demo$/);
    expect(url).toBeInTheDocument();
  });

  it('shows the slug placeholder when no slug is set', () => {
    renderCard({ slug: null as any });
    expect(screen.getByDisplayValue('(set a slug below to generate the URL)')).toBeInTheDocument();
  });

  it('saves landing config via admin-action update_session', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { session: { ...baseSession, description: 'Updated.' } },
      error: null,
    });
    const { onUpdated } = renderCard();

    fireEvent.change(screen.getByLabelText(/Event description/i), { target: { value: 'Updated.' } });
    fireEvent.click(screen.getByRole('button', { name: /Save landing page/i }));

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'admin-action',
        expect.objectContaining({
          body: expect.objectContaining({
            admin_token: 'admin-token',
            action: 'update_session',
            payload: expect.objectContaining({
              id: 'sess-1',
              slug: 'spring-demo',
              description: 'Updated.',
              max_attendees: 100,
              is_full: false,
            }),
          }),
        }),
      );
    });
    expect(toast.success).toHaveBeenCalledWith('Landing page updated');
    expect(onUpdated).toHaveBeenCalled();
  });

  it('clamps max_attendees at 1000', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({ data: {}, error: null });
    renderCard();

    fireEvent.change(screen.getByLabelText(/Max attendees/i), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /Save landing page/i }));

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'admin-action',
        expect.objectContaining({
          body: expect.objectContaining({
            payload: expect.objectContaining({ max_attendees: 1000 }),
          }),
        }),
      );
    });
  });

  it('surfaces save errors as a toast', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { error: 'Slug already in use' },
      error: null,
    });
    const { onUpdated } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: /Save landing page/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Slug already in use'));
    });
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('forwards hero image URL changes into the save payload', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({ data: {}, error: null });
    renderCard();

    fireEvent.change(screen.getByTestId('hero-image-input'), {
      target: { value: 'https://cdn.example/hero.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save landing page/i }));

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'admin-action',
        expect.objectContaining({
          body: expect.objectContaining({
            payload: expect.objectContaining({
              hero_image_url: 'https://cdn.example/hero.jpg',
            }),
          }),
        }),
      );
    });
  });

  it('lists pending signups and wires approve / reject buttons', async () => {
    const participants = [
      { id: 'p1', email: 'a@ex.com', role: 'investor', display_name: 'Alice', approved: false, investor_class: 'accredited' },
      { id: 'p2', email: 'b@ex.com', role: 'investor', display_name: 'Bob', approved: true, investor_class: 'community' },
      { id: 'p3', email: 'c@ex.com', role: 'startup', display_name: 'Co', approved: true },
    ];
    const { onApprove, onReject } = renderCard({}, participants);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument(); // approved → not in pending list
    expect(screen.getByText(/1 \/ 100 approved/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(participants[0]));

    fireEvent.click(screen.getByRole('button', { name: '' })); // ghost X button has no label text
    await waitFor(() => expect(onReject).toHaveBeenCalledWith(participants[0]));
  });

  it('shows an empty state when there are no pending signups', () => {
    renderCard({}, [
      { id: 'p1', email: 'a@ex.com', role: 'investor', display_name: 'A', approved: true },
    ]);
    expect(screen.getByText('No pending signups.')).toBeInTheDocument();
  });

  it('copies the public URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard();

    fireEvent.click(screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-copy'))!);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/event\/spring-demo$/));
    });
    expect(toast.success).toHaveBeenCalledWith('Landing page URL copied');
  });
});
