import { useEffect, useState } from 'react';
import { Check, Copy, Sparkles, X } from 'lucide-react';
import { copyPlainText } from './touch-message-gestures';

export interface CallSummaryState {
  loading: boolean;
  summary?: string;
  decisions?: string[];
  tasks?: string[];
  error?: string;
}

export function CallSummaryNote({
  state,
  onRetry,
  onHide,
}: {
  state: CallSummaryState;
  onRetry: () => void;
  onHide: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const hasSummary =
    typeof state.summary === 'string' && state.summary.length > 0;
  const completedEmpty = !state.loading && !state.error && state.summary === '';

  async function handleCopy() {
    if (!hasSummary) return;
    const lines = [
      state.summary,
      state.decisions?.length
        ? `Quyết định:\n${state.decisions.map((d) => `• ${d}`).join('\n')}`
        : '',
      state.tasks?.length
        ? `Việc cần làm:\n${state.tasks.map((t) => `• ${t}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const ok = await copyPlainText(lines);
    if (ok) setCopied(true);
  }

  return (
    <div className="voice-transcript call-summary-note" aria-live="polite">
      <div className="voice-transcript-header">
        <span className="voice-transcript-badge">
          <Sparkles size={11} aria-hidden="true" />
          Tóm tắt cuộc gọi · AI
        </span>
        <div className="voice-transcript-header-actions">
          {hasSummary && (
            <button
              type="button"
              className="voice-transcript-icon-btn"
              aria-label={
                copied ? 'Đã sao chép tóm tắt' : 'Sao chép tóm tắt cuộc gọi'
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
            aria-label="Ẩn tóm tắt cuộc gọi"
            title="Ẩn"
            onClick={onHide}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      {state.loading && !hasSummary && (
        <p className="voice-transcript-status">
          Đang phân tích và tóm tắt nội dung cuộc gọi…
        </p>
      )}

      {completedEmpty && (
        <p className="voice-transcript-status">
          Không nhận diện được lời nói rõ ràng trong cuộc gọi.
        </p>
      )}

      {hasSummary && <p className="voice-transcript-text">{state.summary}</p>}

      {!!state.decisions?.length && (
        <div className="call-summary-section">
          <strong>Quyết định:</strong>
          <ul>
            {state.decisions.map((decision) => (
              <li key={decision}>{decision}</li>
            ))}
          </ul>
        </div>
      )}

      {!!state.tasks?.length && (
        <div className="call-summary-section">
          <strong>Việc cần làm:</strong>
          <ul>
            {state.tasks.map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ul>
        </div>
      )}

      {state.error && (
        <div className="voice-transcript-error" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={onRetry} disabled={state.loading}>
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}
