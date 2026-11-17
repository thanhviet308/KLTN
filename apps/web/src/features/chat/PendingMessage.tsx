import { CornerUpLeft } from 'lucide-react';
import type { ReplySummary } from '../../lib/chat-model';

export function PendingMessage({
  body,
  replyTo,
  replyLabel,
  status,
  error,
  retryDisabled,
  onRetry,
}: {
  body: string;
  replyTo?: ReplySummary;
  replyLabel?: string;
  status: 'sending' | 'failed';
  error?: string;
  retryDisabled: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="chat-message mine">
      <div className="message-bubble-slot">
        {replyTo && (
          <div className="message-reply-stack">
            {replyLabel && (
              <span className="message-reply-context">
                <CornerUpLeft size={11} aria-hidden="true" />
                <span>{replyLabel}</span>
              </span>
            )}
            <div className="message-reply-quote is-static">
              <span className="message-reply-excerpt">{replyTo.excerpt}</span>
            </div>
          </div>
        )}
        <div className="message-body">{body}</div>
      </div>
      {status === 'sending' ? (
        <small>Đang gửi…</small>
      ) : (
        <>
          <small className="field-error">{error}</small>
          <button className="retry" disabled={retryDisabled} onClick={onRetry}>
            Gửi lại
          </button>
        </>
      )}
    </div>
  );
}
