import { useState } from 'react';
import type { Conversation, Member } from './types';
import './conversation-customization.css';

const backgrounds = [
  ['default', 'Mặc định'],
  ['ocean', 'Biển xanh'],
  ['mint', 'Bạc hà'],
  ['sunset', 'Hoàng hôn'],
  ['rose', 'Hoa hồng'],
  ['sand', 'Cát ấm'],
] as const;

export function ConversationCustomization({
  conversation,
  members,
  busy,
  onSave,
}: {
  conversation: Conversation;
  members: Member[];
  busy: boolean;
  onSave: (path: string, body: unknown) => Promise<void>;
}) {
  const [target, setTarget] = useState(members[0]?.id ?? '');
  const member = members.find((item) => item.id === target) ?? members[0];
  return (
    <section
      className="conversation-customization"
      aria-labelledby="customization-title"
    >
      <h3 id="customization-title">Tùy chỉnh đoạn chat</h3>
      {busy && <p role="status">Đang cập nhật…</p>}
      <p className="hint">
        Biệt danh và nền được hiển thị cho mọi thành viên, chỉ trong đoạn chat
        này.
      </p>
      {member && (
        <div className="chat-nickname-editor">
          <h4>Biệt danh trong đoạn chat</h4>
          <label htmlFor="nickname-member">Đặt biệt danh cho</label>
          <select
            id="nickname-member"
            value={member.id}
            disabled={busy}
            onChange={(event) => setTarget(event.target.value)}
          >
            {members.map((item) => (
              <option key={item.id} value={item.id}>
                {item.user.displayName}
              </option>
            ))}
          </select>
          <NicknameForm
            key={`${member.id}:${conversation.nicknames?.[member.id] ?? ''}`}
            nickname={conversation.nicknames?.[member.id] ?? ''}
            busy={busy}
            onSave={(nickname) =>
              onSave(`members/${member.id}/nickname`, { nickname })
            }
          />
        </div>
      )}
      <fieldset disabled={busy}>
        <legend>Nền đoạn chat</legend>
        <div className="chat-background-options">
          {backgrounds.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="chat-background-option"
              aria-pressed={(conversation.background ?? 'default') === value}
              onClick={() => void onSave('background', { background: value })}
            >
              <span
                className="chat-background-swatch"
                data-chat-background={value}
                aria-hidden="true"
              />
              <span>{label}</span>
              <span className="chat-background-selected" aria-hidden="true">
                {(conversation.background ?? 'default') === value ? '✓' : ''}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function NicknameForm({
  nickname,
  busy,
  onSave,
}: {
  nickname: string;
  busy: boolean;
  onSave: (nickname: string) => Promise<void>;
}) {
  const [value, setValue] = useState(nickname);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(value.trim());
      }}
    >
      <label htmlFor="chat-nickname">Biệt danh</label>
      <input
        id="chat-nickname"
        value={value}
        maxLength={50}
        disabled={busy}
        placeholder="Nhập biệt danh"
        aria-describedby="nickname-help"
        onChange={(event) => setValue(event.target.value)}
      />
      <p id="nickname-help" className="hint">
        Tối đa 50 ký tự. Để trống để dùng lại tên gốc.
      </p>
      <div className="chat-customization-actions">
        <button
          type="submit"
          className="secondary"
          disabled={busy || value.trim() === nickname}
        >
          Lưu biệt danh
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !nickname}
          onClick={() => void onSave('')}
        >
          Khôi phục tên gốc
        </button>
      </div>
    </form>
  );
}
