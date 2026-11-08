import type { Receipt } from '../../lib/chat-model';

/** Delivery / read indicator shown under the user's latest sent message. */
export function SentStatus({
  readers,
  delivered,
  names,
  onOpen,
}: {
  readers: Receipt[];
  delivered: number;
  names: (id: string) => string;
  onOpen: () => void;
}) {
  if (readers.length === 0)
    return (
      <div className="message-meta">
        <button onClick={onOpen}>
          {delivered ? `Đã nhận (${delivered})` : 'Đã gửi'}
        </button>
      </div>
    );
  return (
    <div className="read-avatars" aria-label="Người đã đọc">
      {readers.map((reader) => (
        <button
          key={reader.userId}
          type="button"
          className="read-avatar"
          title={`${names(reader.userId)} đã đọc`}
          aria-label={`${names(reader.userId)} đã đọc. Xem trạng thái tin nhắn`}
          onClick={onOpen}
        >
          {Array.from(names(reader.userId))[0]?.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
