import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { CallProvider, useCalls } from '../src/features/calls/CallProvider';
import { CallScreen } from '../src/features/calls/CallScreen';
import {
  applyCall,
  canJoin,
  hangupAction,
  type Call,
} from '../src/features/calls/call-model';
import * as api from '../src/api';
import { Room } from 'livekit-client';

jest.mock('../src/api', () => ({
  API_ORIGIN: 'https://example.test',
  accessToken: jest.fn().mockResolvedValue('access'),
  authenticated: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock('../src/utils', () => ({ clientMessageId: () => 'request-id' }));
jest.mock('react-native-nitro-sound', () => ({
  __esModule: true,
  default: {
    stopRecorder: jest.fn().mockResolvedValue(''),
    stopPlayer: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../src/features/calls/CallScreen', () => ({
  CallScreen: jest.fn(() => null),
}));
jest.mock('@livekit/react-native', () => ({
  AndroidAudioTypePresets: { communication: {} },
  AudioSession: {
    configureAudio: jest.fn().mockResolvedValue(undefined),
    startAudioSession: jest.fn().mockResolvedValue(undefined),
    stopAudioSession: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('livekit-client', () => ({
  ConnectionState: { Disconnected: 'disconnected', Connected: 'connected' },
  RoomEvent: { ConnectionStateChanged: 'state', Disconnected: 'disconnected' },
  Room: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    state: 'connected',
    localParticipant: {
      setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
      setCameraEnabled: jest.fn().mockResolvedValue(undefined),
    },
  })),
}));
const mockEvents: Record<string, (event: { call: Call }) => void> = {};
jest.mock('socket.io-client', () => ({
  io: () => ({
    connected: true,
    on: (event: string, handler: (value: { call: Call }) => void) => {
      mockEvents[event] = handler;
    },
    removeAllListeners: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
  }),
}));

const incoming: Call = {
  id: 'call-1',
  conversationId: 'chat-1',
  initiatorId: 'peer',
  type: 'video',
  status: 'ringing',
  ringExpiresAt: '2030-01-01T00:00:00Z',
  startedAt: null,
  updatedAt: '2026-11-01T00:00:00Z',
  participants: [
    { userId: 'me', status: 'invited' },
    { userId: 'peer', status: 'accepted' },
  ],
};
const active: Call = {
  ...incoming,
  status: 'active',
  updatedAt: '2026-11-01T00:00:01Z',
  participants: incoming.participants.map(peer => ({
    ...peer,
    status: 'joined',
  })),
};
const ended: Call = {
  ...active,
  status: 'ended',
  updatedAt: '2026-11-01T00:00:02Z',
};
let tree: Renderer.ReactTestRenderer;
let controls: ReturnType<typeof useCalls>;
function Child() {
  controls = useCalls();
  return null;
}
const screen = () => jest.mocked(CallScreen).mock.calls.at(-1)![0];
const request = jest.mocked(api.authenticated);

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .spyOn(PermissionsAndroid, 'requestMultiple')
    .mockImplementation(
      async required =>
        Object.fromEntries(
          required.map(permission => [permission, 'granted']),
        ) as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>,
    );
  request.mockImplementation(async path => {
    if (path.startsWith('/calls?')) return { items: [], nextCursor: null };
    if (path.includes('/members?'))
      return { items: [{ user: { id: 'peer', displayName: 'Người gọi' } }] };
    if (path.startsWith('/conversations/'))
      return { conversation: { type: 'direct', title: null } };
    if (path.endsWith('/token'))
      return { url: 'wss://example.test', token: 'media-token' };
    if (path.endsWith('/accept')) return { call: active };
    if (
      path.endsWith('/end') ||
      path.endsWith('/leave') ||
      path.endsWith('/reject')
    )
      return { call: ended };
    return { call: active };
  });
});
afterEach(async () => {
  if (tree)
    await act(async () => {
      tree.unmount();
    });
  jest.restoreAllMocks();
});
async function mount() {
  await act(async () => {
    tree = Renderer.create(
      <CallProvider
        user={{ id: 'me', email: 'me@example.test', displayName: 'Me' }}
        onExpired={jest.fn()}
      >
        <Child />
      </CallProvider>,
    );
  });
}
async function receive(call: Call, event = 'call:incoming') {
  await act(async () => {
    mockEvents[event]({ call });
  });
}

test('late ringing events cannot reopen an ended call or replace a different ongoing call', () => {
  expect(applyCall(ended, incoming)).toBe(ended);
  expect(applyCall(active, { ...incoming, id: 'other' })).toBe(active);
  expect(applyCall(active, incoming)).toBe(active);
  expect(canJoin(incoming, 'me')).toBe(false);
  expect(hangupAction(incoming, 'me')).toBe('reject');
  expect(hangupAction(active, 'me')).toBe('leave');
  expect(hangupAction(active, 'peer')).toBe('end');
});

test('incoming call is visible outside chat and denied permission does not accept or publish', async () => {
  await mount();
  await receive(incoming);
  expect(screen().incoming).toBe(true);
  jest.mocked(PermissionsAndroid.requestMultiple).mockResolvedValue({
    'android.permission.CAMERA': 'denied',
    'android.permission.RECORD_AUDIO': 'granted',
  } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);
  await act(async () => {
    screen().onJoin();
  });
  expect(screen().error).toContain('cấp quyền');
  expect(request).not.toHaveBeenCalledWith('/calls/call-1/accept', {});
  expect(Room).not.toHaveBeenCalled();
});

test('accept connects with server credentials and publishes audio/video; remote end releases media', async () => {
  await mount();
  await receive(incoming);
  await act(async () => {
    screen().onJoin();
  });
  expect(request).toHaveBeenCalledWith('/calls/call-1/accept', {});
  const room = jest.mocked(Room).mock.results[0].value;
  expect(room.connect).toHaveBeenCalledWith(
    'wss://example.test',
    'media-token',
  );
  expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
  await receive(ended, 'call:updated');
  expect(room.disconnect).toHaveBeenCalled();
  expect(screen().room).toBeUndefined();
  await receive(incoming);
  expect(screen().call?.status).toBe('ended');
});

test('reject sends the matching server action without requesting device permissions', async () => {
  await mount();
  await receive(incoming);
  await act(async () => {
    screen().onHangup();
  });
  expect(request).toHaveBeenCalledWith('/calls/call-1/reject', {});
  expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  expect(Room).not.toHaveBeenCalled();
});

test('remote hangup during token request cannot start a microphone or camera', async () => {
  await mount();
  await receive(incoming);
  let resolveToken!: (value: unknown) => void;
  const implementation = request.getMockImplementation()!;
  request.mockImplementation((path, ...args) =>
    path.endsWith('/token')
      ? new Promise(resolve => {
          resolveToken = resolve;
        })
      : implementation(path, ...args),
  );
  await act(async () => {
    screen().onJoin();
  });
  await receive(ended, 'call:updated');
  await act(async () => {
    resolveToken({ url: 'wss://example.test', token: 'media-token' });
  });
  expect(Room).not.toHaveBeenCalled();
});

test('a double tap creates one outgoing call and audio calls never enable the camera', async () => {
  await mount();
  const outgoing = {
    ...incoming,
    initiatorId: 'me',
    type: 'audio' as const,
    participants: [
      { userId: 'me', status: 'accepted' },
      { userId: 'peer', status: 'invited' },
    ],
  };
  const implementation = request.getMockImplementation()!;
  request.mockImplementation(async (path, ...args) =>
    path === '/conversations/chat-1/calls'
      ? { call: outgoing }
      : implementation(path, ...args),
  );
  await act(async () => {
    controls.start(
      { id: 'chat-1', peer: { displayName: 'Peer' } } as api.Conversation,
      'audio',
    );
    controls.start({ id: 'chat-1' } as api.Conversation, 'audio');
  });
  expect(
    request.mock.calls.filter(
      ([path]) => path === '/conversations/chat-1/calls',
    ),
  ).toHaveLength(1);
  const room = jest.mocked(Room).mock.results[0].value;
  expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  await act(async () => {
    screen().onHangup();
  });
  expect(request).toHaveBeenCalledWith('/calls/call-1/end', {});
});
