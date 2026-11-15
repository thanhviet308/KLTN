import { Check, Users, X } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { UiIcon } from '../../components/UiIcon';
import type { Peer } from '../../lib/types';

export function ComposeForm({
  type,
  onTypeChange,
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
  onTypeChange?: (type: 'direct' | 'group') => void;
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
  const chosenPeers = chosen
    .map((id) => friends.find((peer) => peer.id === id))
    .filter((peer): peer is Peer => !!peer);

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
          <div className="compose-intro-top">
            <div className="compose-title-block">
              <span className="compose-icon" aria-hidden="true">
                <UiIcon
                  name={type === 'direct' ? 'compose' : 'friends'}
                  size={22}
                />
              </span>
              <div>
                <h3>
                  {type === 'direct'
                    ? 'Bắt đầu cuộc trò chuyện'
                    : 'Tạo nhóm trò chuyện'}
                </h3>
                <p>
                  {type === 'direct'
                    ? 'Chọn một người bạn bên dưới để mở khung nhắn tin.'
                    : 'Đặt tên nhóm và chọn các thành viên bạn muốn thêm vào.'}
                </p>
              </div>
            </div>
            {onTypeChange && (
              <div
                className="compose-mode-tabs"
                role="tablist"
                aria-label="Kiểu cuộc trò chuyện"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={type === 'direct'}
                  className={type === 'direct' ? 'is-active' : undefined}
                  onClick={() => onTypeChange('direct')}
                >
                  <UiIcon name="conversations" size={15} />
                  <span>Nhắn riêng</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={type === 'group'}
                  className={type === 'group' ? 'is-active' : undefined}
                  onClick={() => onTypeChange('group')}
                >
                  <UiIcon name="friends" size={15} />
                  <span>Tạo nhóm</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {type === 'group' && (
          <label className="compose-group-name-field">
            <span className="compose-field-header">
              <span>Tên nhóm</span>
              <small>{title.trim().length}/200</small>
            </span>
            <div className="compose-group-name-input">
              <Users size={17} aria-hidden="true" />
              <input
                value={title}
                maxLength={200}
                placeholder="Ví dụ: Nhóm đồ án, Hội bạn thân…"
                onChange={(e) => onTitle(e.target.value)}
              />
            </div>
          </label>
        )}

        {!friends.length && (
          <p className="intro">Bạn cần kết bạn trước khi tạo hội thoại.</p>
        )}

        <div className="compose-search">
          <UiIcon name="search" size={17} />
          <input
            type="search"
            autoFocus={type === 'direct'}
            aria-label="Tìm người nhận"
            placeholder="Tìm bạn theo tên…"
            value={friendFilter}
            onChange={(event) => onFriendFilter(event.target.value)}
          />
        </div>

        {type === 'group' && chosenPeers.length > 0 && (
          <div className="compose-chosen-strip" aria-label="Thành viên đã chọn">
            {chosenPeers.map((peer) => (
              <button
                key={peer.id}
                type="button"
                className="compose-chosen-chip"
                onClick={() => onToggleChosen(peer.id)}
                title={`Bỏ chọn ${peer.displayName}`}
              >
                <span className="peer-avatar">
                  <Avatar peer={peer} />
                </span>
                <span className="compose-chosen-name">{peer.displayName}</span>
                <X size={13} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}

        <div className="compose-list-header">
          <p className="compose-list-label">
            {type === 'direct'
              ? `Danh sách bạn bè (${matchingFriends.length})`
              : 'Chọn thành viên'}
          </p>
          {type === 'group' && (
            <span className="compose-counter-pill">
              Đã chọn {chosen.length}/49
            </span>
          )}
        </div>

        <div className="friend-picker">
          {friends.length > 0 && matchingFriends.length === 0 && (
            <p className="compose-no-results" role="status">
              Không tìm thấy bạn bè phù hợp. Hãy thử tên khác.
            </p>
          )}
          {matchingFriends.map((peer) => {
            const isSelected = chosen.includes(peer.id);
            return type === 'direct' ? (
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
                  <strong>{peer.displayName}</strong>
                  <small>Nhấn để mở cuộc trò chuyện</small>
                </span>
                <span className="compose-peer-arrow" aria-hidden="true">
                  Nhắn tin →
                </span>
              </button>
            ) : (
              <label
                key={peer.id}
                className={`compose-member-row${isSelected ? ' is-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  className="compose-sr-check"
                  name="conversation-peer"
                  checked={isSelected}
                  disabled={chosen.length >= 49 && !isSelected}
                  onChange={() => onToggleChosen(peer.id)}
                />
                <span className="peer-avatar">
                  <Avatar peer={peer} />
                </span>
                <span className="compose-peer-name">
                  <strong>{peer.displayName}</strong>
                  <small>
                    {isSelected
                      ? 'Đã thêm vào danh sách nhóm'
                      : 'Nhấn để chọn vào nhóm'}
                  </small>
                </span>
                <span
                  className={`compose-check-badge${isSelected ? ' is-checked' : ''}`}
                  aria-hidden="true"
                >
                  {isSelected && <Check size={14} strokeWidth={2.6} />}
                </span>
              </label>
            );
          })}
        </div>

        <div className="compose-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Hủy
          </button>
          {type === 'group' && (
            <button
              className="primary"
              disabled={!chosen.length || !title.trim()}
            >
              {chosen.length > 0 ? `Tạo nhóm (${chosen.length})` : 'Tạo nhóm'}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
