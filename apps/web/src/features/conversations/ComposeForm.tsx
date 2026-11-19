import { useEffect, useState } from 'react';
import { Check, Users, X } from 'lucide-react';
import * as api from '../../lib/api';
import { Avatar } from '../../components/Avatar';
import { UiIcon } from '../../components/UiIcon';
import type { Peer } from '../../lib/types';

export function ComposeForm({
  type,
  onTypeChange,
  currentUserName,
  currentUserId,
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
  currentUserName?: string;
  currentUserId?: string;
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
  const [otherUsers, setOtherUsers] = useState<Peer[]>([]);

  useEffect(() => {
    const term = friendFilter.trim();
    if (type !== 'direct' || term.length < 2) {
      setOtherUsers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .authenticated<{ items: ({ user: Peer } | Peer)[] }>(
          `/users?query=${encodeURIComponent(term)}&limit=8`,
        )
        .then((res) => {
          if (cancelled) return;
          const mapped = res.items
            .map((item) => ('user' in item ? item.user : item))
            .filter(
              (u) =>
                u.id !== currentUserId && !friends.some((f) => f.id === u.id),
            );
          setOtherUsers(mapped);
        })
        .catch(() => {
          if (!cancelled) setOtherUsers([]);
        });
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [type, friendFilter, friends, currentUserId]);

  const chosenPeers = chosen
    .map((id) => friends.find((peer) => peer.id === id))
    .filter((peer): peer is Peer => !!peer);

  const autoGroupName = chosenPeers.length
    ? [currentUserName, ...chosenPeers.map((p) => p.displayName)]
        .filter(Boolean)
        .join(', ')
        .slice(0, 90)
    : '';

  return (
    <form
      className="conversation-form compose-card"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (type === 'group' && chosen.length > 0) {
          onSubmit();
        }
      }}
    >
      <fieldset disabled={busy}>
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
              <UiIcon name="conversations" size={16} />
              <span>Nhắn tin riêng</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={type === 'group'}
              className={type === 'group' ? 'is-active' : undefined}
              onClick={() => onTypeChange('group')}
            >
              <UiIcon name="friends" size={16} />
              <span>Tạo nhóm mới</span>
            </button>
          </div>
        )}

        <div className="compose-intro">
          <div className="compose-title-block">
            <span className="compose-icon" aria-hidden="true">
              <UiIcon
                name={type === 'direct' ? 'compose' : 'friends'}
                size={21}
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
                  ? 'Chọn bạn bè hoặc tìm người dùng trên PingPong để nhắn tin ngay.'
                  : 'Chọn thành viên để tạo nhóm ngay — tên nhóm có thể đặt riêng hoặc tự động theo tên thành viên.'}
              </p>
            </div>
          </div>
        </div>

        {type === 'group' && (
          <label className="compose-group-name-field">
            <span className="compose-field-header">
              <span>
                Tên nhóm <em>(không bắt buộc)</em>
              </span>
              <small>{title.trim().length}/200</small>
            </span>
            <div className="compose-group-name-input">
              <Users size={17} aria-hidden="true" />
              <input
                value={title}
                maxLength={200}
                placeholder={
                  autoGroupName
                    ? `Mặc định: ${autoGroupName}`
                    : 'Ví dụ: Nhóm đồ án, Hội bạn thân…'
                }
                onChange={(e) => onTitle(e.target.value)}
              />
            </div>
          </label>
        )}

        <div className="compose-search">
          <UiIcon name="search" size={17} />
          <input
            type="search"
            autoFocus={type === 'direct'}
            aria-label="Tìm người nhận"
            placeholder={
              type === 'direct'
                ? 'Tìm bạn bè hoặc người dùng trên PingPong…'
                : 'Tìm bạn bè để thêm vào nhóm…'
            }
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
                <span className="compose-chosen-remove" aria-hidden="true">
                  <X size={12} strokeWidth={2.5} />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="compose-list-header">
          <p className="compose-list-label">
            {type === 'direct'
              ? `Bạn bè (${matchingFriends.length})`
              : 'Danh sách bạn bè'}
          </p>
          {type === 'group' && (
            <span className="compose-counter-pill">
              Đã chọn {chosen.length}/49
            </span>
          )}
        </div>

        <div className="friend-picker">
          {type === 'group' && !friends.length && (
            <p className="compose-no-results">
              Bạn cần kết bạn trước khi mời thành viên vào nhóm.
            </p>
          )}
          {type === 'direct' &&
            !friends.length &&
            otherUsers.length === 0 &&
            friendFilter.trim().length < 2 && (
              <p className="compose-no-results">
                Nhập ít nhất 2 ký tự ở ô tìm kiếm để tìm người dùng và nhắn tin.
              </p>
            )}
          {friends.length > 0 &&
            matchingFriends.length === 0 &&
            otherUsers.length === 0 && (
              <p className="compose-no-results" role="status">
                Không tìm thấy người phù hợp. Hãy thử từ khóa khác.
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
                  <small>Bạn bè · Nhấn để nhắn tin</small>
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
                    {isSelected ? 'Đã chọn vào nhóm' : 'Nhấn để thêm vào nhóm'}
                  </small>
                </span>
                <span
                  className={`compose-check-badge${isSelected ? ' is-checked' : ''}`}
                  aria-hidden="true"
                >
                  {isSelected && <Check size={13} strokeWidth={2.8} />}
                </span>
              </label>
            );
          })}
          {type === 'direct' && otherUsers.length > 0 && (
            <>
              <p className="compose-sublist-label">Mọi người trên PingPong</p>
              {otherUsers.map((peer) => (
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
                    <small>Chưa kết bạn · Nhấn để nhắn tin</small>
                  </span>
                  <span className="compose-peer-arrow" aria-hidden="true">
                    Nhắn tin →
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="compose-footer">
          {type === 'group' && (
            <span className="compose-footer-hint">
              {chosen.length === 0
                ? 'Chọn ít nhất 1 người bạn để tạo nhóm'
                : `Sẵn sàng tạo nhóm với ${chosen.length} thành viên`}
            </span>
          )}
          <div className="compose-footer-actions">
            <button type="button" className="secondary" onClick={onCancel}>
              Hủy
            </button>
            {type === 'group' && (
              <button
                type="submit"
                className="primary"
                disabled={chosen.length === 0}
              >
                {chosen.length > 0 ? `Tạo nhóm (${chosen.length})` : 'Tạo nhóm'}
              </button>
            )}
          </div>
        </div>
      </fieldset>
    </form>
  );
}
