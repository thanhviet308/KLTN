import { Avatar } from '../../components/Avatar';
import { UiIcon } from '../../components/UiIcon';
import type { Peer } from '../../lib/types';

export function ComposeForm({
  type,
  busy,
  title,
  onTitle,
  friends,
  matchingFriends,
  friendFilter,
  onFriendFilter,
  chosen,
  onToggleChosen,
  onStartDirect,
  onSubmit,
  onCancel,
}: {
  type: 'direct' | 'group';
  busy: boolean;
  title: string;
  onTitle: (value: string) => void;
  friends: Peer[];
  matchingFriends: Peer[];
  friendFilter: string;
  onFriendFilter: (value: string) => void;
  chosen: string[];
  onToggleChosen: (peerId: string) => void;
  onStartDirect: (peerId: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="conversation-form compose-card"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={busy}>
        <div className="compose-intro">
          <span className="compose-icon" aria-hidden="true">
            <UiIcon
              name={type === 'direct' ? 'compose' : 'friends'}
              size={24}
            />
          </span>
          <h3>
            {type === 'direct'
              ? 'Bạn muốn nhắn tin cho ai?'
              : 'Tạo nhóm trò chuyện'}
          </h3>
          <p>
            {type === 'direct'
              ? 'Chọn một người bạn để bắt đầu trò chuyện.'
              : 'Đặt tên nhóm và chọn những người bạn muốn thêm.'}
          </p>
        </div>
        {type === 'group' && (
          <label>
            Tên nhóm
            <input
              value={title}
              maxLength={200}
              onChange={(e) => onTitle(e.target.value)}
            />
          </label>
        )}
        {!friends.length && (
          <p className="intro">Bạn cần kết bạn trước khi tạo hội thoại.</p>
        )}
        <div className="compose-search">
          <UiIcon name="search" size={18} />
          <input
            type="search"
            autoFocus
            aria-label="Tìm người nhận"
            placeholder="Tìm bạn theo tên…"
            value={friendFilter}
            onChange={(event) => onFriendFilter(event.target.value)}
          />
        </div>
        <p className="compose-list-label">
          {type === 'direct'
            ? `Bạn bè · ${matchingFriends.length}`
            : `Chọn thành viên · ${chosen.length}/49`}
        </p>
        <div className="friend-picker">
          {friends.length > 0 && matchingFriends.length === 0 && (
            <p className="compose-no-results" role="status">
              Không tìm thấy bạn bè phù hợp. Hãy thử tên khác.
            </p>
          )}
          {matchingFriends.map((peer) =>
            type === 'direct' ? (
              <button
                className="compose-peer"
                type="button"
                key={peer.id}
                onClick={() => onStartDirect(peer.id)}
              >
                <span className="peer-avatar">
                  <Avatar peer={peer} />
                </span>
                <span className="compose-peer-name">
                  {peer.displayName}
                  <small>Nhấn để mở trò chuyện</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ) : (
              <label key={peer.id}>
                <input
                  type="checkbox"
                  name="conversation-peer"
                  checked={chosen.includes(peer.id)}
                  disabled={chosen.length >= 49 && !chosen.includes(peer.id)}
                  onChange={() => onToggleChosen(peer.id)}
                />
                <span className="peer-avatar">
                  <Avatar peer={peer} />
                </span>
                <span className="compose-peer-name">{peer.displayName}</span>
              </label>
            ),
          )}
        </div>
        <div className="compose-footer">
          {type === 'group' && (
            <button
              className="primary"
              disabled={!chosen.length || !title.trim()}
            >
              Tạo nhóm
            </button>
          )}
          <button type="button" className="secondary" onClick={onCancel}>
            Hủy
          </button>
        </div>
      </fieldset>
    </form>
  );
}
