import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import RssFeedButton from '../RssFeedButton';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('RssFeedButton', () => {
  it('renders an accessible RSS pill on the page', () => {
    render(<RssFeedButton />);
    expect(screen.getByRole('button', { name: /Subscribe via RSS/i })).toBeInTheDocument();
  });

  it('copies the feed URL (with apikey + site params) to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<RssFeedButton />);
    fireEvent.click(screen.getByRole('button', { name: /Subscribe via RSS/i }));

    const copyBtn = await screen.findByRole('button', { name: /Copy/i });
    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = writeText.mock.calls[0][0] as string;
    expect(url).toContain('/functions/v1/events-rss');
    expect(url).toContain('apikey=');
    expect(url).toContain('site=');
    expect(toast.success).toHaveBeenCalledWith('RSS feed URL copied');
  });
});
