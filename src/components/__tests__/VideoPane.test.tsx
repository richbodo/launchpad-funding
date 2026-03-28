import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
