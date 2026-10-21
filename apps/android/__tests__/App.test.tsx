/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

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
