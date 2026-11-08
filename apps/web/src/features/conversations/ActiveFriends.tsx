import { Avatar } from '../../components/Avatar';
import type { Peer } from '../../lib/types';

export function ActiveFriends({
  loading,
  unavailable,
  online,
  hasFriends,
  presenceLoaded,
  busy,
  onRetry,
  onOpen,
}: {
  loading: boolean;
  unavailable: boolean;
  online: Peer[];
  hasFriends: boolean;
  /** False while presence data has not arrived yet. */
  presenceLoaded: boolean;
  busy: boolean;
  onRetry: () => void;
  onOpen: (peerId: string) => void;
}) {
  return (
    <section className="active-friends" aria-label="Bạn bè đang hoạt động">
      {loading ? (
        <p className="active-friends-status" role="status">
          Đang tải bạn bè…
        </p>
      ) : unavailable ? (
        <p className="active-friends-status">
          Chưa tải được danh sách bạn bè.
          <button
            type="button"
            className="retry"
            disabled={busy}
            onClick={onRetry}
          >
            Thử lại
          </button>
        </p>
      ) : online.length > 0 ? (
        <ul className="active-friends-list">
          {online.map((peer) => (
            <li key={peer.id}>
              <button
                type="button"
                disabled={busy}
                title={`${peer.displayName} · Đang hoạt động`}
                aria-label={`Nhắn tin cho ${peer.displayName}, đang hoạt động`}
                onClick={() => onOpen(peer.id)}
              >
                <span className="active-friend-avatar">
                  <Avatar peer={peer} />
                  <span className="presence-dot" aria-hidden="true" />
                </span>
                <span className="active-friend-name">{peer.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="active-friends-status">
          {!presenceLoaded && hasFriends
            ? 'Đang cập nhật trạng thái…'
            : 'Chưa có bạn bè đang hoạt động.'}
        </p>
      )}
    </section>
  );
}
