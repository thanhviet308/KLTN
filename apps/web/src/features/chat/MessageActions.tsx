import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  Flag,
  Forward,
  Languages,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Sparkles,
  Trash2,
} from 'lucide-react';
import * as api from '../../lib/api';
import type { Message } from '../../lib/chat-model';
import { ReportDialog, type ReportTarget } from '../reports/ReportDialog';
import {
  MESSAGE_REACTION_EMOJIS,
  type MessageReactionController,
} from './MessageReactions';
import { summarizeMessageForSheet } from './touch-message-gestures';

async function copyMessageText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* Fallback below supports restricted mobile WebViews. */
    }
  }
  try {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(helper);
    return copied;
  } catch {
    return false;
  }
}

export function MessageActions({
  message,
  pinned,
  mine,
  senderName,
  gameTitle,
  mobileSheetOpen = false,
  onCloseMobileSheet,
  reactions,
  onUpdate,
  onReply,
  onReact,
  onAi,
}: {
  message: Message;
  pinned?: boolean;
  mine: boolean;
  isGroup?: boolean;
  senderName?: string;
  gameTitle?: string;
  mobileSheetOpen?: boolean;
  onCloseMobileSheet?: () => void;
  reactions?: MessageReactionController;
  onUpdate: (message: Message) => void;
  onReply: (message: Message) => void;
  onReact: () => void;
  onAi?: (kind: 'replies' | 'translate') => void;
}) {
  const isText = !message.type || message.type === 'text';
  const [toastNotice, setToastNotice] = useState('');
  useEffect(() => {
    if (!toastNotice) return;
    const timer = window.setTimeout(() => setToastNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toastNotice]);
  const [report, setReport] = useState<ReportTarget>();
  const [mode, setMode] = useState<'forward' | 'edit' | 'recall'>();
  const [menu, setMenu] = useState<{ left: number; top: number }>();
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const sheetElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !menuElement.current?.contains(event.target as Node) &&
        !menuButton.current?.contains(event.target as Node)
      )
        setMenu(undefined);
    };
    const reposition = () => setMenu(undefined);
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [menu]);
  useEffect(() => {
    if (!mobileSheetOpen) return;
    sheetElement.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [mobileSheetOpen]);
  function toggleMenu() {
    if (menu) {
      setMenu(undefined);
      return;
    }
    const bounds = menuButton.current!.getBoundingClientRect();
    const height =
      (mine && isText ? 136 : 56) +
      (isText && onAi ? 88 : 0) +
      (!mine ? (message.type === 'image' ? 132 : 88) : 0) +
      44;
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    setMenu({
      left: Math.max(8, Math.min(bounds.right - 180, vw - 188)),
      top: Math.max(
        8,
        bounds.top > height + 18
          ? bounds.top - height - 8
          : Math.min(bounds.bottom + 8, vh - height - 8),
      ),
    });
  }
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  const [targets, setTargets] = useState<{ id: string; title: string }[]>([]);
  const [target, setTarget] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const closeButton = useRef<HTMLButtonElement>(null);
  async function loadTargets(next?: string) {
    const page = await api.authenticated<{
      items: { id: string; title: string | null; type: string }[];
      nextCursor: string | null;
    }>(`/conversations?limit=50${next ? `&cursor=${next}` : ''}`);
    const rows = await Promise.all(
      page.items
        .filter((item) => item.id !== message.conversationId)
        .map(async (item) => {
          if (item.title) return { id: item.id, title: item.title };
          const members = await api.authenticated<{
            items: { user: { displayName: string } }[];
          }>(`/conversations/${item.id}/members?limit=2`);
          return {
            id: item.id,
            title: members.items
              .map((member) => member.user.displayName)
              .join(' & '),
          };
        }),
    );
    setTargets((previous) => (next ? [...previous, ...rows] : rows));
    setCursor(page.nextCursor);
  }
  async function open(action: 'forward' | 'edit' | 'recall') {
    setMenu(undefined);
    setMode(action);
    setReady(false);
    setError('');
    setBusy(true);
    setTarget('');
    keys.current.clear();
    setTimeout(() => closeButton.current?.focus(), 0);
    try {
      const result = await api.authenticated<{ message: Message }>(
        `/conversations/${message.conversationId}/messages/${message.id}`,
      );
      onUpdate(result.message);
      if (result.message.deletedAt)
        throw new Error('Tin nhắn đã được thu hồi.');
      setText(result.message.body ?? '');
      setVersion(result.message.editedAt ?? null);
      if (action === 'forward') {
        setTargets([]);
        await loadTargets();
      }
      setReady(true);
    } catch (e) {
      setError(
        e instanceof api.ApiError
          ? api.errorMessage(e)
          : 'Tin nhắn không còn khả dụng.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (busy || !ready) return;
    if (mode === 'forward' && !target) {
      setError('Chọn cuộc trò chuyện muốn chuyển tiếp.');
      return;
    }
    if (mode === 'edit' && (!text.trim() || text.length > 10000)) {
      setError('Tin nhắn cần từ 1 đến 10.000 ký tự.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'forward') {
        const key = keys.current.get(target) ?? crypto.randomUUID();
        keys.current.set(target, key);
        await api.authenticated(
          `/conversations/${message.conversationId}/messages/${message.id}/forward`,
          { conversationId: target, clientMessageId: key },
        );
      } else {
        const result = await api.authenticated<{ message: Message }>(
          `/conversations/${message.conversationId}/messages/${message.id}`,
          mode === 'edit'
            ? { body: text, expectedEditedAt: version }
            : undefined,
          mode === 'edit' ? 'PATCH' : 'DELETE',
        );
        onUpdate(result.message);
      }
      setMode(undefined);
    } catch (e) {
      if (e instanceof api.ApiError && e.code === 'MESSAGE_EDIT_CONFLICT') {
        setError(
          'Tin đã được sửa ở nơi khác. Đóng và mở lại để xem phiên bản mới.',
        );
      } else setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (message.deletedAt) return null;

  const closeOverlays = () => {
    setMenu(undefined);
    onCloseMobileSheet?.();
  };

  async function togglePin() {
    closeOverlays();
    try {
      await api.authenticated(
        `/conversations/${message.conversationId}/pins/${message.id}`,
        undefined,
        pinned ? 'DELETE' : 'PUT',
      );
      setError('');
      setToastNotice(
        pinned ? '📌 Đã bỏ ghim tin nhắn.' : '📌 Đã ghim tin nhắn.',
      );
      window.dispatchEvent(
        new CustomEvent('chat:pins', {
          detail: message.conversationId,
        }),
      );
    } catch (e) {
      setToastNotice(api.errorMessage(e));
    }
  }

  interface ActionEntry {
    key: string;
    label: string;
    icon: ReactNode;
    danger?: boolean;
    mobileOnly?: boolean;
    onSelect: () => void;
  }

  const actions: ActionEntry[] = [
    {
      key: 'reply',
      label: 'Trả lời',
      icon: <Reply size={18} aria-hidden="true" />,
      mobileOnly: true,
      onSelect: () => {
        closeOverlays();
        onReply(message);
      },
    },
    ...(isText && message.body?.trim()
      ? [
          {
            key: 'copy',
            label: 'Sao chép',
            icon: <Copy size={18} aria-hidden="true" />,
            mobileOnly: true,
            onSelect: () => {
              closeOverlays();
              void copyMessageText(message.body ?? '').then((ok) =>
                setToastNotice(
                  ok
                    ? '📋 Đã sao chép tin nhắn.'
                    : 'Không thể sao chép tự động trên trình duyệt này.',
                ),
              );
            },
          },
        ]
      : []),
    {
      key: 'pin',
      label: pinned ? 'Bỏ ghim tin nhắn' : 'Ghim tin nhắn',
      icon: pinned ? (
        <PinOff size={18} aria-hidden="true" />
      ) : (
        <Pin size={18} aria-hidden="true" />
      ),
      onSelect: () => void togglePin(),
    },
    ...(message.type !== 'call'
      ? [
          {
            key: 'forward',
            label: 'Chuyển tiếp',
            icon: <Forward size={18} aria-hidden="true" />,
            onSelect: () => {
              closeOverlays();
              void open('forward');
            },
          },
        ]
      : []),
    ...(isText && onAi
      ? [
          {
            key: 'ai-replies',
            label: 'Gợi ý trả lời với AI',
            icon: <Sparkles size={18} aria-hidden="true" />,
            onSelect: () => {
              closeOverlays();
              onAi('replies');
            },
          },
          {
            key: 'ai-translate',
            label: 'Dịch tin nhắn',
            icon: <Languages size={18} aria-hidden="true" />,
            onSelect: () => {
              closeOverlays();
              onAi('translate');
            },
          },
        ]
      : []),
    ...(mine && isText
      ? [
          {
            key: 'edit',
            label: 'Sửa tin nhắn',
            icon: <Pencil size={18} aria-hidden="true" />,
            onSelect: () => {
              closeOverlays();
              void open('edit');
            },
          },
        ]
      : []),
    ...(mine
      ? [
          {
            key: 'recall',
            label: 'Thu hồi',
            icon: <Trash2 size={18} aria-hidden="true" />,
            danger: true,
            onSelect: () => {
              closeOverlays();
              void open('recall');
            },
          },
        ]
      : [
          {
            key: 'report-message',
            label: 'Báo cáo tin nhắn',
            icon: <Flag size={18} aria-hidden="true" />,
            onSelect: () => {
              closeOverlays();
              setReport({
                targetType: 'message',
                targetId: message.id,
                label: 'Báo cáo tin nhắn',
              });
            },
          },
          ...(message.type === 'image' && message.content?.attachmentId
            ? [
                {
                  key: 'report-image',
                  label: 'Báo cáo ảnh',
                  icon: <Flag size={18} aria-hidden="true" />,
                  onSelect: () => {
                    closeOverlays();
                    setReport({
                      targetType: 'attachment',
                      targetId: message.content!.attachmentId!,
                      label: 'Báo cáo ảnh',
                    });
                  },
                },
              ]
            : []),
          {
            key: 'report-sender',
            label: 'Báo cáo người gửi',
            icon: <Flag size={18} aria-hidden="true" />,
            onSelect: () => {
              closeOverlays();
              setReport({
                targetType: 'user',
                targetId: message.senderId,
                label: 'Báo cáo người gửi',
              });
            },
          },
        ]),
  ];

  const desktopActions = actions.filter((entry) => !entry.mobileOnly);

  return (
    <>
      <div className={`message-tools${menu ? ' menu-open' : ''}`}>
        <button
          type="button"
          data-tooltip="Bày tỏ cảm xúc"
          aria-label="Bày tỏ cảm xúc"
          onClick={onReact}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M8 14c2 3 6 3 8 0" />
            <path d="M8 9h1m6 0h1" />
          </svg>
        </button>
        <button
          type="button"
          data-tooltip="Trả lời tin nhắn"
          aria-label="Trả lời tin nhắn"
          onClick={() => onReply(message)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m9 4-6 6 6 6M3 10h9c6 0 9 4 9 10" />
          </svg>
        </button>
        <button
          type="button"
          ref={menuButton}
          aria-label="Thêm thao tác"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={toggleMenu}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>
      </div>
      {menu &&
        createPortal(
          <div
            ref={menuElement}
            className="message-action-menu"
            role="menu"
            aria-label="Thao tác tin nhắn"
            style={menu}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setMenu(undefined);
                menuButton.current?.focus();
              }
              if (event.key === 'Tab') setMenu(undefined);
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button',
                  ),
                );
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  (index +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    buttons.length) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            {desktopActions.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                className={entry.danger ? 'is-danger' : undefined}
                onClick={entry.onSelect}
              >
                {entry.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      {mobileSheetOpen &&
        createPortal(
          <div
            className="message-sheet-backdrop"
            onClick={(event) => {
              if (
                event.target === event.currentTarget &&
                !(reactions?.busy ?? false)
              )
                onCloseMobileSheet?.();
            }}
          >
            <section
              ref={sheetElement}
              className="message-bottom-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Thao tác tin nhắn"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !(reactions?.busy ?? false)) {
                  onCloseMobileSheet?.();
                }
                if (event.key === 'Tab') {
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      'button:not(:disabled)',
                    ),
                  );
                  const first = buttons[0];
                  const last = buttons.at(-1);
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                  } else if (
                    !event.shiftKey &&
                    document.activeElement === last
                  ) {
                    event.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <div className="message-sheet-handle" aria-hidden="true" />
              {reactions && (
                <div
                  className="message-sheet-reactions"
                  role="group"
                  aria-label="Bày tỏ cảm xúc"
                >
                  {MESSAGE_REACTION_EMOJIS.map(({ emoji, name }) => {
                    const reacted = reactions.items.some(
                      (item) => item.emoji === emoji && item.reacted,
                    );
                    return (
                      <button
                        key={emoji}
                        type="button"
                        className={reacted ? 'is-reacted' : undefined}
                        aria-label={name}
                        aria-pressed={reacted}
                        disabled={reactions.busy}
                        onClick={() => void reactions.react(emoji)}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              )}
              {reactions?.error && (
                <p className="message error" role="alert">
                  {reactions.error}
                </p>
              )}
              <div className="message-sheet-preview">
                {senderName && <strong>{mine ? 'Bạn' : senderName}</strong>}
                <span>{summarizeMessageForSheet(message, gameTitle)}</span>
              </div>
              <div className="message-sheet-actions">
                {actions.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`message-sheet-item${entry.danger ? ' is-danger' : ''}`}
                    onClick={entry.onSelect}
                  >
                    <span className="message-sheet-icon">{entry.icon}</span>
                    <span>{entry.label}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>,
          document.body,
        )}
      {toastNotice &&
        createPortal(
          <div role="status" className="pin-feedback-toast">
            <span>{toastNotice}</span>
            <button type="button" onClick={() => setToastNotice('')}>
              Đóng
            </button>
          </div>,
          document.body,
        )}
      {report && (
        <ReportDialog
          target={report}
          onClose={() => {
            setReport(undefined);
            menuButton.current?.focus();
          }}
        />
      )}
      {mode &&
        createPortal(
          <div
            className="message-modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) setMode(undefined);
            }}
          >
            <section
              className="message-action-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={
                mode === 'forward'
                  ? 'Chuyển tiếp tin nhắn'
                  : mode === 'edit'
                    ? 'Sửa tin nhắn'
                    : 'Thu hồi tin nhắn'
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !busy) setMode(undefined);
                if (e.key === 'Tab') {
                  const elements = [
                    ...e.currentTarget.querySelectorAll<HTMLElement>(
                      'button:not(:disabled), textarea, select',
                    ),
                  ];
                  const first = elements[0],
                    last = elements.at(-1);
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <button
                ref={closeButton}
                className="retry modal-close"
                disabled={busy}
                onClick={() => setMode(undefined)}
              >
                Đóng
              </button>
              <h2>
                {mode === 'forward'
                  ? 'Chuyển tiếp tin nhắn'
                  : mode === 'edit'
                    ? 'Sửa tin nhắn'
                    : 'Thu hồi tin nhắn?'}
              </h2>
              {error && (
                <p className="message error" role="alert">
                  {error}
                </p>
              )}
              {mode === 'recall' ? (
                <p>
                  Tin này sẽ được thay bằng “Tin nhắn đã thu hồi” với mọi người.
                </p>
              ) : mode === 'edit' ? (
                <textarea
                  aria-label="Nội dung sửa"
                  value={text}
                  maxLength={10000}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                />
              ) : (
                <>
                  <p className="forward-preview">{text}</p>
                  <label>
                    Chọn cuộc trò chuyện
                    <select
                      disabled={busy}
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Chọn nơi gửi</option>
                      {targets.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {cursor && (
                    <button
                      className="retry"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void loadTargets(cursor)
                          .catch((e) => setError(api.errorMessage(e)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      Xem thêm
                    </button>
                  )}
                  <p className="hint">Nội dung sẽ được gửi dưới tên của bạn.</p>
                </>
              )}
              <button
                className="primary"
                disabled={busy || !ready || (mode === 'forward' && !target)}
                onClick={() => void submit()}
              >
                {busy
                  ? 'Đang xử lý…'
                  : mode === 'forward'
                    ? 'Chuyển tiếp'
                    : mode === 'edit'
                      ? 'Lưu thay đổi'
                      : 'Thu hồi'}
              </button>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
