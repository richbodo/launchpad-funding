import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import ImageUploadField from '../ImageUploadField';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

vi.mock('@/lib/adminAuth', () => ({
  getAdminToken: () => 'test-token',
}));

import { supabase } from '@/integrations/supabase/client';

/**
 * Issue #44: Verifies client-side validation in ImageUploadField rejects
 * unsupported types, oversize files, and empty files before invoking the
 * upload edge function.
 */
describe('ImageUploadField validation', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderField = () =>
    render(
      <ImageUploadField
        label="Hero"
        value=""
        onChange={onChange}
        kind="session-hero"
        refId="abc-123"
      />
    );

  const getFileInput = (container: HTMLElement): HTMLInputElement =>
    container.querySelector('input[type="file"]') as HTMLInputElement;

  const fireFile = (input: HTMLInputElement, file: File) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  };

  it('rejects unsupported file types', async () => {
    const { container } = renderField();
    const file = new File(['hi'], 'doc.pdf', { type: 'application/pdf' });
    fireFile(getFileInput(container), file);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported image type')
      );
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects files larger than 5MB', async () => {
    const { container } = renderField();
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([big], 'big.png', { type: 'image/png' });
    fireFile(getFileInput(container), file);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Maximum size is 5MB')
      );
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('rejects empty files', async () => {
    const { container } = renderField();
    const file = new File([], 'empty.png', { type: 'image/png' });
    fireFile(getFileInput(container), file);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('empty')
      );
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('errors when refId is missing (record not saved)', async () => {
    const { container } = render(
      <ImageUploadField
        label="Hero"
        value=""
        onChange={onChange}
        kind="participant"
        refId=""
      />
    );
    const file = new File([new Uint8Array(10)], 'ok.png', { type: 'image/png' });
    fireFile(getFileInput(container), file);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Save the record first')
      );
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('uploads valid images and reports success', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { url: 'https://example.com/img.png' },
      error: null,
    });
    const { container } = renderField();
    const file = new File([new Uint8Array(1024)], 'ok.png', { type: 'image/png' });
    fireFile(getFileInput(container), file);

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'upload-event-image',
        expect.objectContaining({
          body: expect.objectContaining({
            admin_token: 'test-token',
            content_type: 'image/png',
            kind: 'session-hero',
            ref_id: 'abc-123',
            filename: 'ok.png',
          }),
        })
      );
    });
    expect(onChange).toHaveBeenCalledWith('https://example.com/img.png');
    expect(toast.success).toHaveBeenCalledWith('Image uploaded');
  });
});
