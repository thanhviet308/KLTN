export function PendingMessage({
  body,
  status,
  error,
  retryDisabled,
  onRetry,
}: {
  body: string;
  status: 'sending' | 'failed';
  error?: string;
  retryDisabled: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="chat-message mine">
      <div className="message-body">{body}</div>
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
