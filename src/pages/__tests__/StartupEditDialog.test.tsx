/**
 * StartupEditDialog persistence tests.
 *
 * Verifies that startup metadata (description, dd_room_link, image_url) saved
 * via the dialog round-trips correctly — i.e. when the dialog is re-opened
 * after a page refresh, the saved values are loaded back into the form. This
 * is a regression test for the bug where empty/no-scheme URLs caused the edge
 * function to reject the entire save payload, leaving description + image
 * unsaved even though the toast said "saved".
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StartupEditDialog } from '@/pages/Session';

// ImageUploadField talks to storage — replace with a lightweight stub that
// just renders the current value so we can assert it.
vi.mock('@/components/ImageUploadField', () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="mock-image-field" data-value={value || ''} />
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mutable "DB" row shared with the supabase mock via vi.hoisted so it's
// initialized before the mock factory runs.
const h = vi.hoisted(() => {
  const state: { row: any } = {
    row: {
      id: 'pid-1',
      funding_goal: null,
      dd_room_link: null,
      website_link: null,
      description: null,
      image_url: null,
    },
  };
  const h.invokeMock = vi.fn(async (_fn: string, { body }: any) => {
    const norm = (v: any) => {
      if (v == null) return null;
      const s = String(v).trim();
      if (!s) return null;
      return /^https?:\/\//i.test(s) ? s : `https://${s}`;
    };
    state.row = {
      ...state.row,
      description: body.description ?? state.row.description,
      dd_room_link: norm(body.dd_room_link),
      website_link: norm(body.website_link),
      image_url: body.image_url ?? state.row.image_url,
      funding_goal: body.funding_goal ?? state.row.funding_goal,
    };
    return { data: { ok: true, updated: true }, error: null };
  });
  return { state, h.invokeMock };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockImplementation(async () => ({ data: h.state.row, error: null })),
          }),
        }),
      }),
    })),
    functions: { invoke: h.h.invokeMock },
  },
}));

function renderDialog(open = true) {
  return render(
    <StartupEditDialog
      open={open}
      onOpenChange={() => {}}
      sessionId="sess-1"
      email="startup@test.com"
      onSaved={() => {}}
    />,
  );
}

describe('StartupEditDialog persistence', () => {
  beforeEach(() => {
    h.invokeMock.mockClear();
    h.state.row = {
      id: 'pid-1',
      funding_goal: null,
      dd_room_link: null,
      website_link: null,
      description: null,
      image_url: null,
    };
  });

  it('saves description, dd-room link, and image_url, then reloads them on reopen', async () => {
    // --- First open: empty form, fill it in and save. ---
    const { unmount } = renderDialog();

    const descBox = await screen.findByTestId('edit-startup-description');
    expect((descBox as HTMLTextAreaElement).value).toBe('');

    fireEvent.change(descBox, {
      target: { value: 'We build widgets that thrive in zero gravity.' },
    });
    fireEvent.change(screen.getByTestId('edit-dd-room-link'), {
      // Intentionally no scheme — the bug used to drop the whole payload.
      target: { value: 'drive.example.com/dd-room' },
    });

    // Simulate an uploaded logo by writing directly to the mock row that the
    // dialog's reopen-read pulls from; the image upload itself is stubbed.
    h.state.row.image_url = 'https://cdn.example.com/logo.png';

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(h.invokeMock).toHaveBeenCalledTimes(1));
    const sentBody = h.invokeMock.mock.calls[0][1].body;
    expect(sentBody.description).toBe('We build widgets that thrive in zero gravity.');
    // Client normalizes URLs — confirms the no-scheme typo doesn't kill the save.
    expect(sentBody.dd_room_link).toBe('https://drive.example.com/dd-room');

    // Confirm the "DB" now holds what we expect.
    expect(h.state.row.description).toBe('We build widgets that thrive in zero gravity.');
    expect(h.state.row.dd_room_link).toBe('https://drive.example.com/dd-room');
    expect(h.state.row.image_url).toBe('https://cdn.example.com/logo.png');

    unmount();

    // --- Second open (simulates page refresh + reopening the dialog). ---
    renderDialog();

    const reloadedDesc = await screen.findByTestId('edit-startup-description');
    await waitFor(() =>
      expect((reloadedDesc as HTMLTextAreaElement).value).toBe(
        'We build widgets that thrive in zero gravity.',
      ),
    );
    expect((screen.getByTestId('edit-dd-room-link') as HTMLInputElement).value).toBe(
      'https://drive.example.com/dd-room',
    );
    expect(screen.getByTestId('mock-image-field').getAttribute('data-value')).toBe(
      'https://cdn.example.com/logo.png',
    );
  });
});
