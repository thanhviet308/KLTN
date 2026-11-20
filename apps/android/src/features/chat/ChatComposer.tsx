import React, {
  forwardRef,
  memo,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from 'react-native';
import type * as api from '../../api';
import { UiGlyph } from '../../components/Icons';
import { styles } from '../../styles';

const QUICK_EMOJIS = [
  '😀',
  '😂',
  '🥰',
  '😍',
  '🤩',
  '😊',
  '🙏',
  '👍',
  '❤️',
  '🔥',
  '🎉',
  '✨',
  '😢',
  '😮',
  '🤔',
  '👏',
  '💯',
  '👋',
];

export interface ChatComposerHandle {
  focus: () => void;
  setDraft: (value: string) => void;
  closeEmoji: () => boolean;
}

export interface ChatComposerProps {
  sending: boolean;
  recording: boolean;
  recordingMs: number;
  replyTo?: api.Message;
  editing?: api.Message;
  replyContextTitle?: string;
  contextPreview?: string;
  onCancelContext: () => void;
  onSend: (text: string) => Promise<boolean>;
  onTypingChange: (typing: boolean) => void;
  onClearError: () => void;
  onOpenMediaMenu: () => void;
  onStartRecording: () => void;
  onFinishRecording: (sendRecording: boolean) => void;
  onBeforeSendScroll?: () => void;
}

export const ChatComposer = memo(
  forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
    {
      sending,
      recording,
      recordingMs,
      replyTo,
      editing,
      replyContextTitle,
      contextPreview,
      onCancelContext,
      onSend,
      onTypingChange,
      onClearError,
      onOpenMediaMenu,
      onStartRecording,
      onFinishRecording,
      onBeforeSendScroll,
    },
    ref,
  ) {
    const [body, setBody] = useState('');
    const [emojiOpen, setEmojiOpen] = useState(false);
    const inputRef = useRef<TextInputInstance>(null);
    const focusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
          focusTimerRef.current = setTimeout(() => {
            inputRef.current?.focus();
          }, 60);
        },
        setDraft: (value: string) => {
          setBody(value);
          setEmojiOpen(false);
        },
        closeEmoji: () => {
          if (!emojiOpen) return false;
          setEmojiOpen(false);
          return true;
        },
      }),
      [emojiOpen],
    );

    async function handleSend(quickText?: string) {
      const text = (quickText ?? body).trim();
      if (sending || !text) return;
      setEmojiOpen(false);
      onBeforeSendScroll?.();
      const ok = await onSend(text);
      if (ok && !quickText) {
        setBody('');
      }
    }

    return (
      <>
        {(replyTo || editing) && (
          <View style={styles.composerContext}>
            <View style={styles.composerContextText}>
              <Text style={styles.composerContextTitle}>
                {replyContextTitle}
              </Text>
              <Text numberOfLines={1} style={styles.composerContextPreview}>
                {contextPreview}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Hủy thao tác"
              onPress={() => {
                onCancelContext();
                setBody('');
              }}
              style={styles.contextClose}
            >
              <Text style={styles.contextCloseText}>×</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.composerShell}>
          {emojiOpen && !recording && (
            <View style={styles.emojiPickerCard}>
              {QUICK_EMOJIS.map(emoji => (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    setBody(prev =>
                      prev.length + emoji.length <= 10000 ? prev + emoji : prev,
                    );
                    setEmojiOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.emojiPickerCell,
                    pressed && styles.attachButtonPressed,
                  ]}
                >
                  <Text style={{ fontSize: 22 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {recording ? (
            <View style={styles.recordingBar}>
              <View style={styles.recordingPulse} />
              <View style={styles.recordingTextBox}>
                <Text style={styles.recordingTitle}>Đang ghi âm</Text>
                <Text style={styles.recordingTime}>
                  {Math.floor(recordingMs / 60000)
                    .toString()
                    .padStart(2, '0')}
                  :
                  {Math.floor((recordingMs % 60000) / 1000)
                    .toString()
                    .padStart(2, '0')}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Hủy ghi âm"
                onPress={() => onFinishRecording(false)}
                style={styles.recordingCancel}
              >
                <Text style={styles.recordingCancelText}>Hủy</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Dừng và gửi ghi âm"
                onPress={() => onFinishRecording(true)}
                style={styles.recordingSend}
              >
                <Text style={styles.recordingSendText}>Gửi</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.composerRow}>
              {!editing && !body.trim() && (
                <View style={styles.composerMediaTools}>
                  <Pressable
                    accessibilityLabel="Gửi ảnh, tệp, vị trí hoặc ghi âm"
                    accessibilityRole="button"
                    disabled={sending}
                    onPress={onOpenMediaMenu}
                    style={({ pressed }) => [
                      styles.attachButton,
                      pressed && styles.attachButtonPressed,
                    ]}
                  >
                    <UiGlyph name="plus" color="#b75020" size={18} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Ghi âm tin nhắn thoại"
                    accessibilityRole="button"
                    disabled={sending}
                    onPress={onStartRecording}
                    style={({ pressed }) => [
                      styles.attachButton,
                      pressed && styles.attachButtonPressed,
                    ]}
                  >
                    <UiGlyph name="mic" color="#b75020" size={18} />
                  </Pressable>
                </View>
              )}
              <View style={styles.composer}>
                <TextInput
                  ref={inputRef}
                  accessibilityLabel="Nội dung tin nhắn"
                  editable={!sending}
                  maxLength={10000}
                  multiline
                  onChangeText={value => {
                    setBody(value);
                    onClearError();
                    onTypingChange(!!value.trim());
                  }}
                  onBlur={() => onTypingChange(false)}
                  placeholder={editing ? 'Sửa tin nhắn…' : 'Nhập tin nhắn…'}
                  placeholderTextColor="#897e73"
                  style={styles.composerInput}
                  textAlignVertical="center"
                  value={body}
                />
                <Pressable
                  accessibilityLabel="Chọn biểu tượng cảm xúc"
                  accessibilityRole="button"
                  disabled={sending}
                  onPress={() => setEmojiOpen(prev => !prev)}
                  style={({ pressed }) => [
                    styles.composerEmojiBtn,
                    (emojiOpen || pressed) && styles.attachButtonPressed,
                  ]}
                >
                  <UiGlyph name="smile" color="#76553b" size={18} />
                </Pressable>
                <Pressable
                  accessibilityLabel={
                    body.trim() || editing ? 'Gửi tin nhắn' : 'Gửi lượt thích'
                  }
                  accessibilityRole="button"
                  accessibilityState={{
                    busy: sending,
                    disabled: sending || (!!editing && !body.trim()),
                  }}
                  disabled={sending || (!!editing && !body.trim())}
                  onPress={() => {
                    if (!body.trim() && !editing) {
                      void handleSend('👍');
                    } else {
                      void handleSend();
                    }
                  }}
                  style={({ pressed }) => [
                    styles.sendButton,
                    pressed && styles.pressed,
                    (sending || (!!editing && !body.trim())) &&
                      styles.sendButtonDisabled,
                  ]}
                >
                  {sending ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : body.trim() || editing ? (
                    <UiGlyph name="send" color="#ffffff" size={15} />
                  ) : (
                    <UiGlyph name="like" color="#ffffff" size={16} />
                  )}
                </Pressable>
              </View>
            </View>
          )}
          {body.length > 9000 && (
            <Text style={styles.characterCount}>
              {body.length.toLocaleString('vi-VN')}/10.000
            </Text>
          )}
        </View>
      </>
    );
  }),
);
