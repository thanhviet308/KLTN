import { Check } from 'lucide-react';
import type { Receipt } from '../../lib/chat-model';
import type { Peer } from '../../lib/types';
import { Avatar } from '../../components/Avatar';

const MAX_STACKED_READERS = 5;

/** Messenger-style delivery / read indicator for sent messages. */
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
  if (readers.length === 0) {
    const label = delivered
      ? delivered > 1
        ? `Đã nhận (${delivered})`
        : 'Đã nhận'
      : 'Đã gửi';
    return (
      <div className="sent-status-inline">
        <button
          type="button"
          className={`sent-status-badge ${delivered ? 'is-delivered' : 'is-sent'}`}
          title={label}
          aria-label={`${label}. Xem trạng thái tin nhắn`}
          onClick={onOpen}
        >
          <Check size={9} strokeWidth={3} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (readers.length === 1) {
    const reader = readers[0];
    const peer = peers.find((item) => item.id === reader.userId);
    const readerName = names(reader.userId);
    return (
      <div className="sent-status-inline" aria-label="Người đã đọc">
        <button
          type="button"
          className="read-avatar is-inline"
          title={`${readerName} đã đọc`}
          aria-label={`${readerName} đã đọc. Xem trạng thái tin nhắn`}
          onClick={onOpen}
        >
          <Avatar
            peer={
              peer ?? {
                displayName: readerName,
              }
            }
          />
        </button>
      </div>
    );
  }

  const visibleReaders = readers.slice(0, MAX_STACKED_READERS);
  const extraCount = readers.length - visibleReaders.length;

  return (
    <div className="read-avatars is-multi" aria-label="Người đã đọc">
      {visibleReaders.map((reader) => {
        const peer = peers.find((item) => item.id === reader.userId);
        const readerName = names(reader.userId);
        return (
          <button
            key={reader.userId}
            type="button"
            className="read-avatar"
            title={`${readerName} đã đọc`}
            aria-label={`${readerName} đã đọc. Xem trạng thái tin nhắn`}
            onClick={onOpen}
          >
            <Avatar
              peer={
                peer ?? {
                  displayName: readerName,
                }
              }
            />
          </button>
        );
      })}
      {extraCount > 0 && (
        <button
          type="button"
          className="read-avatar is-overflow"
          title={`+${extraCount} người khác đã đọc`}
          aria-label={`Xem tất cả ${readers.length} người đã đọc`}
          onClick={onOpen}
        >
          +{extraCount}
        </button>
      )}
    </div>
  );
}
