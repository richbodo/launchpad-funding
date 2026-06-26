import React from 'react';
import { vi } from 'vitest';

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useParticipants: vi.fn(() => []),
  useTracks: vi.fn(() => []),
  useRoomContext: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
  VideoTrack: ({ trackRef }: any) =>
    React.createElement('div', {
      'data-testid': `video-track-${trackRef?.participant?.identity ?? 'unknown'}`,
    }),
  useLocalParticipant: vi.fn(() => ({
    localParticipant: {
      isMicrophoneEnabled: true,
      setMicrophoneEnabled: vi.fn(),
    },
  })),
  RoomAudioRenderer: () => null,
  StartAudio: () => null,
}));

vi.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } },
  ConnectionQuality: { Excellent: 'excellent', Good: 'good', Poor: 'poor', Lost: 'lost', Unknown: 'unknown' },
  RoomEvent: { Reconnecting: 'reconnecting', Reconnected: 'reconnected', ConnectionStateChanged: 'connectionStateChanged' },
  DisconnectReason: { CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2, PARTICIPANT_REMOVED: 4, ROOM_DELETED: 5 },
}));
