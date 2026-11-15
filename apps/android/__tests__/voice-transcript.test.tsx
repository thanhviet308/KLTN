import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as api from '../src/api';
import { MessageMedia } from '../src/features/chat/MessageMedia';
import { VoiceTranscriptCard } from '../src/features/chat/VoiceTranscriptCard';

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

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' },
  getGenericPassword: jest.fn().mockResolvedValue(false),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  setGenericPassword: jest.fn().mockResolvedValue(true),
}));

function textOf(node: ReactTestRenderer.ReactTestInstance): string {
  return node.children
    .map(child => (typeof child === 'string' ? child : textOf(child)))
    .join('');
}

const sampleVoiceMessage: api.Message = {
  id: '30000000-0000-4000-8000-000000000001',
  conversationId: '10000000-0000-4000-8000-000000000001',
  senderId: '20000000-0000-4000-8000-000000000002',
  clientMessageId: '00000000-0000-4000-8000-000000000099',
  type: 'voice',
  body: null,
  editedAt: null,
  deletedAt: null,
  sequence: '5',
  createdAt: '2026-11-15T10:00:00.000Z',
  content: { fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 12000 },
};

describe('Android voice transcription UI and AI error handling', () => {
  test('VoiceTranscriptCard triggers translate, quick replies, retry, and hide callbacks', () => {
    const onRetry = jest.fn();
    const onTranslate = jest.fn();
    const onSuggestReplies = jest.fn();
    const onUseReply = jest.fn();
    const onHide = jest.fn();

    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <VoiceTranscriptCard
          mine={false}
          onHide={onHide}
          onRetry={onRetry}
          onSuggestReplies={onSuggestReplies}
          onTranslate={onTranslate}
          onUseReply={onUseReply}
          state={{
            loading: false,
            transcript: 'Chiều nay 3 giờ họp nhóm nhé.',
            language: 'vi',
            translation: 'Group meeting at 3 PM.',
            translatedLanguage: 'en',
            replies: ['Ok nhé, mình có mặt đúng giờ'],
          }}
        />,
      );
    });

    const pressables = tree.root.findAll(
      node => node.props && typeof node.props.onPress === 'function',
    );
    const hideBtn = pressables.find(node => textOf(node).includes('Ẩn'));
    const viBtn = pressables.find(node => textOf(node).includes('Dịch Việt'));
    const replyBtn = pressables.find(node =>
      textOf(node).includes('Ok nhé, mình có mặt đúng giờ'),
    );

    expect(hideBtn).toBeDefined();
    expect(viBtn).toBeDefined();
    expect(replyBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      viBtn!.props.onPress();
      replyBtn!.props.onPress();
      hideBtn!.props.onPress();
    });

    expect(onTranslate).toHaveBeenCalledWith('vi');
    expect(onUseReply).toHaveBeenCalledWith('Ok nhé, mình có mặt đúng giờ');
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test('MessageMedia renders compact Chép lời trigger for voice messages and hides when open', () => {
    const onTranscribe = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <MessageMedia
          loading={false}
          localPath="/cache/voice.m4a"
          message={sampleVoiceMessage}
          mine={false}
          onLoad={jest.fn()}
          onOpen={jest.fn()}
          onPlay={jest.fn()}
          onTranscribe={onTranscribe}
          playing={false}
          transcribed={false}
          transcribing={false}
        />,
      );
    });

    const trigger = tree.root.findAll(
      node =>
        node.props &&
        typeof node.props.onPress === 'function' &&
        textOf(node).includes('✨ Chép lời'),
    )[0];
    expect(trigger).toBeDefined();

    ReactTestRenderer.act(() => {
      trigger.props.onPress();
    });
    expect(onTranscribe).toHaveBeenCalledTimes(1);

    ReactTestRenderer.act(() => {
      tree.update(
        <MessageMedia
          loading={false}
          localPath="/cache/voice.m4a"
          message={sampleVoiceMessage}
          mine={false}
          onLoad={jest.fn()}
          onOpen={jest.fn()}
          onPlay={jest.fn()}
          onTranscribe={onTranscribe}
          playing={false}
          transcribed
          transcribing={false}
        />,
      );
    });
    const hiddenTriggers = tree.root.findAll(
      node =>
        node.props &&
        typeof node.props.onPress === 'function' &&
        textOf(node).includes('✨ Chép lời'),
    );
    expect(hiddenTriggers).toHaveLength(0);
  });

  test('Android errorMessage translates AI error codes cleanly', () => {
    expect(api.errorMessage(new api.ApiError(429, 'AI_QUOTA_EXCEEDED'))).toBe(
      'Bạn đã dùng hết 20 lượt AI trong giờ này. Vui lòng thử lại sau.',
    );
    expect(
      api.errorMessage(new api.ApiError(404, 'AI_SOURCE_UNAVAILABLE')),
    ).toContain('thu hồi');
    expect(api.errorMessage(new api.ApiError(504, 'AI_TIMEOUT'))).toContain(
      'quá lâu',
    );
  });
});
