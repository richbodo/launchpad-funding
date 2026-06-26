import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import '@/test/mocks/livekit';
import VideoPane from '../VideoPane';

// Wrap in a simple provider-free render since VideoPane doesn't use context
function renderVideoPane(props: React.ComponentProps<typeof VideoPane>) {
  return render(<VideoPane {...props} />);
}

describe('VideoPane', () => {
  it('renders Placeholder when participantIdentity is undefined', () => {
    renderVideoPane({ label: 'Host', sublabel: 'Stream' });
    expect(screen.getByText('Host')).toBeInTheDocument();
    expect(screen.getByText('Stream')).toBeInTheDocument();
    // No video track should be rendered
    expect(screen.queryByTestId(/video-track/)).not.toBeInTheDocument();
  });

  it('renders LiveVideoPane when participantIdentity is provided', () => {
    renderVideoPane({
      label: 'Host',
      participantIdentity: 'host@test.com',
    });
    // LiveVideoPane is rendered — useTracks returns [] so it falls back
    // to connecting placeholder, but the component branch is LiveVideoPane
    expect(screen.getByText('Host')).toBeInTheDocument();
  });

  it('Placeholder shows "Start Call" for facilitator self-pane when idle + not live', () => {
    renderVideoPane({
      label: 'Facilitator',
      callState: 'idle',
      isSelf: true,
      selfRole: 'facilitator',
      sessionStatus: 'scheduled',
      onStartCall: () => {},
    });
    expect(screen.getByText('Start Call')).toBeInTheDocument();
  });

  it('Placeholder shows "Join Call" for facilitator self-pane when idle + live', () => {
    renderVideoPane({
      label: 'Facilitator',
      callState: 'idle',
      isSelf: true,
      selfRole: 'facilitator',
      sessionStatus: 'live',
      onJoinCall: () => {},
    });
    expect(screen.getByText('Join Call')).toBeInTheDocument();
  });

  it('Placeholder shows "Join Call" for startup self-pane when live', () => {
    renderVideoPane({
      label: 'AlphaTech',
      callState: 'idle',
      isSelf: true,
      selfRole: 'startup',
      sessionStatus: 'live',
      onJoinCall: () => {},
    });
    expect(screen.getByText('Join Call')).toBeInTheDocument();
  });

  it('Placeholder shows "Waiting for host..." for startup self-pane when not live', () => {
    renderVideoPane({
      label: 'AlphaTech',
      callState: 'idle',
      isSelf: true,
      selfRole: 'startup',
      sessionStatus: 'scheduled',
      onJoinCall: () => {},
    });
    expect(screen.getByText('Waiting for host...')).toBeInTheDocument();
  });

  it('Placeholder shows spinner when callState is "connecting"', () => {
    renderVideoPane({
      label: 'Host',
      callState: 'connecting',
    });
    // The Loader2 spinner has the animate-spin class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('"Live" badge appears when isActive is true', () => {
    renderVideoPane({
      label: 'AlphaTech',
      isActive: true,
    });
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('label and sublabel render correctly', () => {
    renderVideoPane({
      label: 'Test Label',
      sublabel: 'Test Sublabel',
    });
    expect(screen.getByText('Test Label')).toBeInTheDocument();
    expect(screen.getByText('Test Sublabel')).toBeInTheDocument();
  });

  // Regression test for GitHub issue #33:
  // When a remote LiveKit track never arrives for a participant we expect a
  // joining placeholder, then — after the 12s watchdog — an automatic
  // "Taking longer than usual…" message with a Refresh button (the recovery
  // path users had to discover manually by leaving and rejoining).
  it('surfaces Refresh button after 12s when remote track never arrives', async () => {
    vi.useFakeTimers();
    try {
      // Simulate the participant being present in the LiveKit room but with
      // no published track yet — this is the genuine stuck-subscription case
      // the watchdog is designed for.
      const { useParticipants } = await import('@livekit/components-react');
      (useParticipants as ReturnType<typeof vi.fn>).mockReturnValue([
        { identity: 'startup-a@test.com' },
      ]);

      renderVideoPane({
        label: 'AlphaTech',
        participantIdentity: 'startup-a@test.com',
      });

      expect(screen.queryByText(/Taking longer than usual/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Refresh/i })).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(12_000);
      });

      expect(screen.getByText(/Taking longer than usual/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      const { useParticipants } = await import('@livekit/components-react');
      (useParticipants as ReturnType<typeof vi.fn>).mockReturnValue([]);
    }
  });

  it('shows "Hasn\'t joined yet" (no watchdog) when remote facilitator is not in the room', async () => {
    vi.useFakeTimers();
    try {
      renderVideoPane({
        label: 'Amarit',
        sublabel: 'Host Stream',
        participantIdentity: 'amarit@test.com',
      });

      // Immediately shows the not-joined state — no spinner, no watchdog.
      expect(screen.getByText(/Hasn't joined yet/i)).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });

      // Even after the watchdog window, no misleading Refresh button appears.
      expect(screen.queryByText(/Taking longer than usual/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Refresh/i })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
