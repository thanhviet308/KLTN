import { Sparkles } from 'lucide-react';

export function TimeDivider({ createdAt }: { createdAt: string }) {
  return (
    <div className="chat-time-divider">
      <time dateTime={createdAt}>
        {new Intl.DateTimeFormat('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(createdAt))}
      </time>
    </div>
  );
}

export function UnreadDivider({
  count,
  onSummarize,
}: {
  count: number;
  /** Omit to hide the AI summary shortcut. */
  onSummarize?: () => void;
}) {
  return (
    <div
      className="unread-divider"
      role="separator"
      aria-label={`${count} tin nhắn chưa đọc`}
    >
      <span>{count} tin nhắn chưa đọc</span>
      {onSummarize && (
        <button type="button" onClick={onSummarize}>
          <Sparkles size={15} aria-hidden="true" />
          Tóm tắt bằng AI
        </button>
      )}
    </div>
  );
}
