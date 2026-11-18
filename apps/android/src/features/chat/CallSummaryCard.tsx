import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { styles } from '../../styles';

export type CallSummaryEntry = {
  loading: boolean;
  summary?: string;
  decisions?: string[];
  tasks?: string[];
  error?: string;
};

export function CallSummaryCard({
  mine,
  state,
  onRetry,
  onHide,
}: {
  mine: boolean;
  state: CallSummaryEntry;
  onRetry: () => void;
  onHide: () => void;
}) {
  const hasSummary =
    typeof state.summary === 'string' && state.summary.length > 0;
  const completedEmpty = !state.loading && !state.error && state.summary === '';

  return (
    <View
      style={[
        styles.voiceTranscriptCard,
        mine && styles.voiceTranscriptCardMine,
      ]}
    >
      <View style={styles.voiceTranscriptHeader}>
        <Text style={styles.voiceTranscriptTitle}>
          ✨ Tóm tắt cuộc gọi · AI
        </Text>
        <View style={styles.voiceTranscriptHeaderActions}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onHide}>
            <Text style={styles.voiceTranscriptHide}>Ẩn</Text>
          </Pressable>
        </View>
      </View>

      {state.loading && !hasSummary && (
        <Text style={styles.voiceTranscriptMuted}>
          Đang phân tích và tóm tắt nội dung cuộc gọi…
        </Text>
      )}

      {completedEmpty && (
        <Text style={styles.voiceTranscriptMuted}>
          Không nhận diện được lời nói rõ ràng trong cuộc gọi.
        </Text>
      )}

      {hasSummary && (
        <Text selectable style={styles.voiceTranscriptText}>
          {state.summary}
        </Text>
      )}

      {!!state.decisions?.length && (
        <Text selectable style={styles.voiceTranscriptTranslationText}>
          <Text style={styles.voiceTranscriptTranslationTag}>
            Quyết định:{'\n'}
          </Text>
          {state.decisions.map(item => `• ${item}`).join('\n')}
        </Text>
      )}

      {!!state.tasks?.length && (
        <Text selectable style={styles.voiceTranscriptTranslationText}>
          <Text style={styles.voiceTranscriptTranslationTag}>
            Việc cần làm:{'\n'}
          </Text>
          {state.tasks.map(item => `• ${item}`).join('\n')}
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
    </View>
  );
}
