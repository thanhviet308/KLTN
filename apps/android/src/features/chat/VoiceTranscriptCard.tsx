import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { styles } from '../../styles';

export type VoiceTranscriptEntry = {
  loading: boolean;
  transcript?: string;
  language?: string;
  translation?: string;
  translatedLanguage?: 'vi' | 'en';
  replies?: string[];
  error?: string;
};

export function VoiceTranscriptCard({
  mine,
  state,
  onRetry,
  onTranslate,
  onSuggestReplies,
  onUseReply,
  onHide,
}: {
  mine: boolean;
  state: VoiceTranscriptEntry;
  onRetry: () => void;
  onTranslate: (language: 'vi' | 'en') => void;
  onSuggestReplies: () => void;
  onUseReply: (reply: string) => void;
  onHide: () => void;
}) {
  const languageTag =
    state.language && state.language !== 'unknown'
      ? state.language.toUpperCase()
      : 'AI';
  const hasTranscript = !!state.transcript;
  const completedEmpty =
    !state.loading && !state.error && state.transcript === '';

  return (
    <View
      style={[
        styles.voiceTranscriptCard,
        mine && styles.voiceTranscriptCardMine,
      ]}
    >
      <View style={styles.voiceTranscriptHeader}>
        <Text style={styles.voiceTranscriptTitle}>
          ✨ Chép lời · {languageTag}
        </Text>
        <View style={styles.voiceTranscriptHeaderActions}>
          {hasTranscript && state.translatedLanguage !== 'vi' && (
            <Pressable
              accessibilityRole="button"
              disabled={state.loading}
              hitSlop={6}
              onPress={() => onTranslate('vi')}
              style={({ pressed }) => [
                styles.voiceTranscriptMiniChip,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.voiceTranscriptMiniChipText}>Dịch Việt</Text>
            </Pressable>
          )}
          {hasTranscript && state.translatedLanguage !== 'en' && (
            <Pressable
              accessibilityRole="button"
              disabled={state.loading}
              hitSlop={6}
              onPress={() => onTranslate('en')}
              style={({ pressed }) => [
                styles.voiceTranscriptMiniChip,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.voiceTranscriptMiniChipText}>Dịch EN</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onHide}>
            <Text style={styles.voiceTranscriptHide}>Ẩn</Text>
          </Pressable>
        </View>
      </View>

      {state.loading && !hasTranscript && (
        <Text style={styles.voiceTranscriptMuted}>Đang nghe và chép lời…</Text>
      )}

      {completedEmpty && (
        <Text style={styles.voiceTranscriptMuted}>
          Không nhận diện được lời nói rõ ràng.
        </Text>
      )}

      {hasTranscript && (
        <Text selectable style={styles.voiceTranscriptText}>
          {state.transcript}
        </Text>
      )}

      {!!state.translation && (
        <Text selectable style={styles.voiceTranscriptTranslationText}>
          <Text style={styles.voiceTranscriptTranslationTag}>
            {(state.translatedLanguage ?? 'vi').toUpperCase()}:{' '}
          </Text>
          {state.translation}
        </Text>
      )}

      {!!state.error && (
        <View style={styles.voiceTranscriptErrorRow}>
          <Text style={styles.voiceTranscriptErrorText}>{state.error}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={state.loading}
            onPress={onRetry}
          >
            <Text style={styles.voiceTranscriptHide}>Thử lại</Text>
          </Pressable>
        </View>
      )}

      {hasTranscript && !state.replies?.length && (
        <View style={styles.voiceTranscriptActions}>
          <Pressable
            accessibilityRole="button"
            disabled={state.loading}
            onPress={onSuggestReplies}
            style={({ pressed }) => [
              styles.voiceTranscriptChip,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.voiceTranscriptChipText}>
              {state.loading ? 'Đang tạo…' : '✨ Gợi ý trả lời'}
            </Text>
          </Pressable>
        </View>
      )}

      {!!state.replies?.length && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.voiceReplyChips}
          style={styles.voiceReplyStrip}
        >
          {state.replies.map(reply => (
            <Pressable
              key={reply}
              accessibilityRole="button"
              onPress={() => onUseReply(reply)}
              style={({ pressed }) => [
                styles.voiceReplyChip,
                pressed && styles.pressed,
              ]}
            >
              <Text numberOfLines={1} style={styles.voiceReplyChipText}>
                {reply}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
