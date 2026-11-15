import { useEffect, useState } from 'react';
import { Check, Copy, Languages, Sparkles, X } from 'lucide-react';
import {
  AI_LANGUAGES,
  type AiLanguageCode,
  type VoiceTranscribeOptions,
  type VoiceTranscriptState,
} from '../ai/ai-model';
import { copyPlainText } from './touch-message-gestures';

export function VoiceTranscriptNote({
  state,
  onRetry,
  onTranslate,
  onSuggestReplies,
  onUseReply,
  onHide,
}: {
  state: VoiceTranscriptState;
  onRetry: () => void;
  onTranslate: (language: AiLanguageCode) => void;
  onSuggestReplies: () => void;
  onUseReply: (reply: string) => void;
  onHide: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    if (!state.transcript) return;
    const ok = await copyPlainText(state.transcript);
    if (ok) setCopied(true);
  }

  const languageTag =
    state.language && state.language !== 'unknown'
      ? state.language.toUpperCase()
      : 'AI';
  const hasTranscript = !!state.transcript;
  const completedEmpty =
    !state.loading && !state.error && state.transcript === '';

  return (
    <div className="voice-transcript" aria-live="polite">
      <div className="voice-transcript-header">
        <span className="voice-transcript-badge">
          <Sparkles size={11} aria-hidden="true" />
          Chép lời · {languageTag}
        </span>
        <div className="voice-transcript-header-actions">
          {hasTranscript && (
            <span className="voice-transcript-translate">
              <Languages size={11} aria-hidden="true" />
              <select
                className="voice-transcript-select"
                aria-label="Dịch nội dung tin nhắn thoại"
                disabled={state.loading}
                value={state.translatedLanguage ?? ''}
                onChange={(event) => {
                  const next = event.target.value as AiLanguageCode | '';
                  if (next) onTranslate(next);
                }}
              >
                <option value="">Dịch</option>
                {Object.entries(AI_LANGUAGES).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </span>
          )}
          {hasTranscript && (
            <button
              type="button"
              className="voice-transcript-icon-btn"
              aria-label={
                copied ? 'Đã sao chép lời thoại' : 'Sao chép lời thoại'
              }
              title={copied ? 'Đã sao chép' : 'Sao chép'}
              onClick={() => void handleCopy()}
            >
              {copied ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                <Copy size={12} aria-hidden="true" />
              )}
            </button>
          )}
          <button
            type="button"
            className="voice-transcript-icon-btn"
            aria-label="Ẩn bản chép lời"
            title="Ẩn"
            onClick={onHide}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      {state.loading && !hasTranscript && (
        <p className="voice-transcript-status">Đang nghe và chép lời…</p>
      )}

      {completedEmpty && (
        <p className="voice-transcript-status">
          Không nhận diện được lời nói rõ ràng.
        </p>
      )}

      {hasTranscript && (
        <p className="voice-transcript-text">{state.transcript}</p>
      )}

      {state.translation && (
        <p className="voice-transcript-translation">
          <strong>{(state.translatedLanguage ?? 'vi').toUpperCase()}:</strong>{' '}
          {state.translation}
        </p>
      )}

      {state.error && (
        <div className="voice-transcript-error" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={onRetry} disabled={state.loading}>
            Thử lại
          </button>
        </div>
      )}

      {hasTranscript && !state.replies?.length && (
        <div className="voice-transcript-actions">
          <button
            type="button"
            className="voice-transcript-action"
            disabled={state.loading}
            onClick={onSuggestReplies}
          >
            <Sparkles size={11} aria-hidden="true" />
            {state.loading ? 'Đang tạo…' : 'Gợi ý trả lời'}
          </button>
        </div>
      )}

      {!!state.replies?.length && (
        <div className="voice-reply-chips" aria-label="Gợi ý trả lời bằng AI">
          {state.replies.map((reply) => (
            <button
              key={reply}
              type="button"
              className="voice-reply-chip"
              onClick={() => onUseReply(reply)}
            >
              {reply}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type { VoiceTranscribeOptions };
