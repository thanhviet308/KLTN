import { messageSummary, type Message } from '../../lib/chat-model';

export function ReplyPreview({
  message,
  senderName,
  onCancel,
}: {
  message: Message;
  senderName: string;
  onCancel: () => void;
}) {
  return (
    <div className="reply-preview">
      <div>
        <strong>Trả lời {senderName}</strong>
        <p>{messageSummary(message).slice(0, 300)}</p>
      </div>
      <button
        type="button"
        className="retry"
        aria-label="Hủy trả lời"
        onClick={onCancel}
      >
        ×
      </button>
    </div>
  );
}
