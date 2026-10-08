import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from './api';
import type { Message } from './chat-model';

const emojis = [
  { emoji: '❤️', name: 'Yêu thích' },
  { emoji: '😂', name: 'Haha' },
  { emoji: '😮', name: 'Ngạc nhiên' },
  { emoji: '😢', name: 'Buồn' },
  { emoji: '😡', name: 'Tức giận' },
  { emoji: '👍', name: 'Thích' },
];
interface Item {
  emoji: string;
  count: number;
  reacted: boolean;
}
export function MessageReactions({
  message,
  revision,
  open,
  onClose,
  active,
}: {
  message: Message;
  revision: number;
  open: boolean;
  onClose: () => void;
  active: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  const path = `/conversations/${message.conversationId}/messages/${message.id}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  async function load() {
    const version = ++generation.current;
    try {
      const result = await api.authenticated<{ items: Item[] }>(
        `${path}/reactions`,
      );
      if (mounted.current && version === generation.current)
        setItems(result.items);
    } catch (e) {
      if (mounted.current && version === generation.current && open)
        setError(api.errorMessage(e));
    }
  }
  useEffect(() => {
    if (!active || message.deletedAt) {
      setItems([]);
      generation.current++;
      return;
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [revision, active, message.deletedAt, open]);
  useEffect(() => {
    if (open) {
      setError('');
      dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [open]);
  async function react(emoji: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    generation.current++;
    try {
      const remove = items.some((item) => item.emoji === emoji && item.reacted);
      const result = await api.authenticated<{ items: Item[] }>(
        `${path}/reaction`,
        remove ? undefined : { emoji },
        remove ? 'DELETE' : 'PUT',
      );
      generation.current++;
      if (mounted.current) {
        setItems(result.items);
        onClose();
      }
    } catch (e) {
      if (mounted.current) setError(api.errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (message.deletedAt) return null;
  return (
    <>
      {items.length > 0 && (
        <div className="reaction-badges">
          {items.map((item) => (
            <button
              type="button"
              key={item.emoji}
              className={item.reacted ? 'reacted' : ''}
              disabled={busy}
              aria-pressed={item.reacted}
              aria-label={`${item.emoji}, ${item.count} lượt${item.reacted ? ', bạn đã bày tỏ. Nhấn để gỡ' : '. Nhấn để bày tỏ'}`}
              onClick={() => void react(item.emoji)}
            >
              {item.emoji}
              <span>{item.count}</span>
            </button>
          ))}
        </div>
      )}
      {error && !open && (
        <small className="reaction-error" role="alert">
          {error}
        </small>
      )}
      {open &&
        createPortal(
          <div
            className="message-modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) onClose();
            }}
          >
            <div
              className="emoji-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Bày tỏ cảm xúc"
              ref={dialog}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !busy) onClose();
                if (e.key === 'Tab') {
                  const buttons = [
                    ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                      'button:not(:disabled)',
                    ),
                  ];
                  if (e.shiftKey && document.activeElement === buttons[0]) {
                    e.preventDefault();
                    buttons.at(-1)?.focus();
                  } else if (
                    !e.shiftKey &&
                    document.activeElement === buttons.at(-1)
                  ) {
                    e.preventDefault();
                    buttons[0]?.focus();
                  }
                }
              }}
            >
              <div className="emoji-options">
                {emojis.map(({ emoji, name }) => (
                  <button
                    key={emoji}
                    type="button"
                    title={name}
                    aria-label={name}
                    aria-pressed={items.some(
                      (item) => item.emoji === emoji && item.reacted,
                    )}
                    disabled={busy}
                    onClick={() => void react(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              {error && (
                <p className="message error" role="alert">
                  {error}
                </p>
              )}
              <button
                type="button"
                className="retry"
                disabled={busy}
                onClick={onClose}
              >
                Đóng
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
