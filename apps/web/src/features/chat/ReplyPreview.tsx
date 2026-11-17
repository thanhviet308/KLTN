import { CornerUpLeft, X } from 'lucide-react';
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
        <strong>
          <CornerUpLeft size={13} aria-hidden="true" />
          Đang trả lời {senderName}
        </strong>
        <p>{messageSummary(message).slice(0, 300)}</p>
      </div>
      <button
        type="button"
        className="retry reply-preview-close"
        aria-label="Hủy trả lời"
        onClick={onCancel}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
