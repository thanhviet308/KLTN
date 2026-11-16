import type { Receipt } from '../../lib/chat-model';
import type { Peer } from '../../lib/types';
import { Avatar } from '../../components/Avatar';

/** Delivery / read indicator shown under the user's latest sent message. */
export function SentStatus({
  readers,
  delivered,
  peers = [],
  names,
  onOpen,
}: {
  readers: Receipt[];
  delivered: number;
  peers?: Peer[];
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
      {readers.map((reader) => {
        const peer = peers.find((item) => item.id === reader.userId);
        return (
          <button
            key={reader.userId}
            type="button"
            className="read-avatar"
            title={`${names(reader.userId)} đã đọc`}
            aria-label={`${names(reader.userId)} đã đọc. Xem trạng thái tin nhắn`}
            onClick={onOpen}
          >
            <Avatar
              peer={
                peer ?? {
                  displayName: names(reader.userId),
                }
              }
            />
          </button>
        );
      })}
    </div>
  );
}
