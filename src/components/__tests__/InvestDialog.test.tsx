/**
 * Regression tests for issue #41 — gift pledges.
 *
 * Verifies the gift-mode UI:
 *  - Confirm button is disabled while the amount exceeds the $100 community cap.
 *  - A friendly cap warning is shown when the user exceeds the cap.
 *  - Equity-mode dialog is unchanged (no cap warning, no max attribute).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InvestDialog from '../InvestDialog';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

vi.mock('@/lib/sessionContext', () => ({
  useSessionUser: () => ({
    user: {
      participantId: 'p-1',
      email: 'supporter@test.com',
      role: 'investor',
      displayName: 'Supporter',
      sessionId: 'sess-1',
      investorClass: 'community',
    },
  }),
}));

function renderDialog(pledgeType: 'equity' | 'gift') {
  return render(
    <InvestDialog
      open={true}
      onOpenChange={() => {}}
      sessionId="sess-1"
      startupName="Acme"
      startupEmail="acme@test.com"
      pledgeType={pledgeType}
    />,
  );
}

describe('InvestDialog — gift mode (issue #41)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('caps gift pledges at $100 (button disabled when over)', () => {
    renderDialog('gift');
    const input = screen.getByTestId('invest-amount-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '250' } });

    const confirm = screen.getByTestId('invest-confirm-btn') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getByTestId('gift-cap-warning')).toBeInTheDocument();
  });

  it('allows gift pledges of $100 or less', () => {
    renderDialog('gift');
    const input = screen.getByTestId('invest-amount-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });

    const confirm = screen.getByTestId('invest-confirm-btn') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(screen.queryByTestId('gift-cap-warning')).not.toBeInTheDocument();
  });

  it('shows the gift-mode title and label', () => {
    renderDialog('gift');
    expect(screen.getByText(/Pledge a gift to Acme/)).toBeInTheDocument();
    expect(screen.getByText(/Pledge Amount/)).toBeInTheDocument();
  });

  it('equity mode imposes no cap and uses commitment copy', () => {
    renderDialog('equity');
    const input = screen.getByTestId('invest-amount-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500000' } });
    const confirm = screen.getByTestId('invest-confirm-btn') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(screen.queryByTestId('gift-cap-warning')).not.toBeInTheDocument();
    expect(screen.getByText(/Invest in Acme/)).toBeInTheDocument();
  });
});
