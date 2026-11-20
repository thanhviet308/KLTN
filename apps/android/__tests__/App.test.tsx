/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import App from '../App';
import * as api from '../src/api';
import { Chat } from '../src/features/chat/ChatScreen';
import { ChatHistoryCache } from '../src/features/chat/chat-history-cache';

jest.mock('../src/features/calls/CallProvider', () => ({
  CallProvider: ({ children }: { children: React.ReactNode }) => children,
  useCalls: () => ({ start: jest.fn(), busy: false }),
}));

jest.mock('@react-native-documents/picker', () => ({
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: jest.fn(() => false),
  pick: jest.fn(),
}));

jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    config: jest.fn(() => ({ fetch: jest.fn() })),
    wrap: jest.fn((value: string) => value),
    fs: { unlink: jest.fn().mockResolvedValue(undefined) },
    android: { actionViewIntent: jest.fn() },
    ios: { openDocument: jest.fn() },
  },
}));

jest.mock('react-native-nitro-sound', () => ({
  __esModule: true,
  default: {
    addPlaybackEndListener: jest.fn(),
    addPlayBackListener: jest.fn(),
    addRecordBackListener: jest.fn(),
    removePlaybackEndListener: jest.fn(),
    removePlayBackListener: jest.fn(),
    removeRecordBackListener: jest.fn(),
    startPlayer: jest.fn(),
    startRecorder: jest.fn(),
    stopPlayer: jest.fn().mockResolvedValue(undefined),
    stopRecorder: jest.fn().mockResolvedValue(''),
  },
}));

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' },
  getGenericPassword: jest.fn().mockResolvedValue(false),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  setGenericPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    auth: {},
    connected: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    emit: jest.fn(),
    on: jest.fn(),
    removeAllListeners: jest.fn(),
    timeout: jest.fn().mockReturnThis(),
  })),
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});

test('reopening Android chat shows recent messages while the server refresh is pending', async () => {
  const user = { id: 'me', email: 'me@example.test', displayName: 'Me' };
  const conversation: api.Conversation = {
    id: 'chat-1',
    type: 'direct',
    title: 'Chat',
    unreadCount: 0,
    lastMessageSequence: '1',
    membership: { role: 'member', lastReadSequence: null },
    peer: null,
    lastMessage: null,
  };
  const message: api.Message = {
    id: 'message-1',
    conversationId: conversation.id,
    senderId: user.id,
    clientMessageId: 'local-1',
    sequence: '1',
    body: 'Tin nhắn đã lưu',
    type: 'text',
    createdAt: '2026-11-20T01:00:00Z',
    editedAt: null,
    deletedAt: null,
  };
  const history = new ChatHistoryCache();
  const empty = { items: [], nextCursor: null, highWatermark: '1' };
  const page = { ...empty, items: [message] };
  let finishRefresh!: (value: typeof empty) => void;
  const request = jest
    .spyOn(api, 'authenticated')
    .mockImplementation(async path => {
      if (path.includes('/messages?'))
        return request.mock.calls.filter(([url]) => url.includes('/messages?'))
          .length === 1
          ? page
          : new Promise(resolve => {
              finishRefresh = resolve;
            });
      return empty;
    });
  const token = jest.spyOn(api, 'accessToken').mockResolvedValue('token');
  let tree: ReactTestRenderer.ReactTestRenderer;
  const open = async (next = conversation) => {
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <Chat
          conversation={next}
          history={history}
          user={user}
          onBack={() => {}}
          onExpired={() => {}}
        />,
      );
    });
  };
  const visible = () =>
    tree.root
      .findAllByType(Text)
      .some(text => text.props.children === message.body);
  try {
    await open();
    expect(visible()).toBe(true);
    await ReactTestRenderer.act(async () => tree.unmount());
    await open();
    expect(visible()).toBe(true);
    const historyRequests = () =>
      request.mock.calls.filter(([url]) => url.includes('/messages?')).length;
    expect(historyRequests()).toBe(1);
    await ReactTestRenderer.act(async () => tree.unmount());

    const preload = history.loadRecent(conversation.id, 0n);
    await open({ ...conversation, lastMessageSequence: '2' });
    expect(visible()).toBe(true);
    expect(historyRequests()).toBe(2);
    await ReactTestRenderer.act(async () => finishRefresh(empty));
    await preload;
    expect(visible()).toBe(false);
  } finally {
    await ReactTestRenderer.act(async () => tree?.unmount());
    request.mockRestore();
    token.mockRestore();
  }
}, 15000);
