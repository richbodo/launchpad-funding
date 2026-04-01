import React from 'react';
import { vi } from 'vitest';

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useParticipants: vi.fn(() => []),
  useTracks: vi.fn(() => []),
  VideoTrack: ({ trackRef }: any) =>
    React.createElement('div', {
      'data-testid': `video-track-${trackRef?.participant?.identity ?? 'unknown'}`,
    }),
  useLocalParticipant: vi.fn(() => ({ localParticipant: null })),
  RoomAudioRenderer: () => null,
}));

vi.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } },
}));
