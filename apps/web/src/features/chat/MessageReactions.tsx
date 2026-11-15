import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../../lib/api';
import type { Message } from '../../lib/chat-model';

export const MESSAGE_REACTION_EMOJIS = [
  { emoji: '❤️', name: 'Yêu thích' },
  { emoji: '😂', name: 'Haha' },
  { emoji: '😮', name: 'Ngạc nhiên' },
  { emoji: '😢', name: 'Buồn' },
  { emoji: '😡', name: 'Tức giận' },
  { emoji: '👍', name: 'Thích' },
];
export interface ReactionItem {
  emoji: string;
  count: number;
  reacted: boolean;
}
export interface MessageReactionController {
  items: ReactionItem[];
  busy: boolean;
  error: string;
  react: (emoji: string) => Promise<void>;
}
const REACTION_CACHE_TTL_MS = 30_000;
const reactionCache = new Map<
  string,
  { items: ReactionItem[]; revision: number; fetchedAt: number }
>();
function rememberReaction(
  key: string,
  items: ReactionItem[],
  revision: number,
) {
  reactionCache.delete(key);
  reactionCache.set(key, { items, revision, fetchedAt: Date.now() });
  if (reactionCache.size > 500)
    reactionCache.delete(reactionCache.keys().next().value!);
}

/**
 * Loads, caches, and toggles reactions for a single timeline message.
 */
export function useMessageReactions({
  message,
  revision,
  open,
  onClose,
  active,
  enabled = true,
  realtimeConnected,
}: {
  message: Message;
  revision: number;
  open: boolean;
  onClose: () => void;
  active: boolean;
  enabled?: boolean;
  realtimeConnected: boolean;
}): MessageReactionController {
  const cacheKey = `${api.currentUserId() ?? 'anon'}:${message.id}`;
  const [items, setItems] = useState<ReactionItem[]>(() => {
    const cached = reactionCache.get(cacheKey);
    return cached && cached.revision === revision ? cached.items : [];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const path = `/conversations/${message.conversationId}/messages/${message.id}`;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active || !enabled) return;
    const element = document.querySelector(
      `[data-message-id="${CSS.escape(message.id)}"]`,
    );
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { root: element.closest('.message-timeline'), rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, enabled, message.id]);
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
      const result = await api.authenticated<{ items: ReactionItem[] }>(
        `${path}/reactions`,
      );
      rememberReaction(cacheKey, result.items, revision);
      if (mounted.current && version === generation.current)
        setItems(result.items);
    } catch (e) {
      if (mounted.current && version === generation.current && open)
        setError(api.errorMessage(e));
    }
  }
  useEffect(() => {
    if (!active || !enabled || message.deletedAt) {
      reactionCache.delete(cacheKey);
      setItems([]);
      generation.current++;
      return;
    }
    if (!visible && !open) return;
    const cached = reactionCache.get(cacheKey);
    const fresh =
      !!cached &&
      cached.revision === revision &&
      Date.now() - cached.fetchedAt < REACTION_CACHE_TTL_MS;
    if (fresh) setItems(cached.items);
    if (!fresh) void load();
    const timer = realtimeConnected
      ? undefined
      : setInterval(() => {
          if (document.visibilityState === 'visible') void load();
        }, 30000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [
    revision,
    active,
    enabled,
    message.deletedAt,
    open,
    realtimeConnected,
    visible,
  ]);
  useEffect(() => {
    if (open) setError('');
  }, [open]);
  async function react(emoji: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    generation.current++;
    try {
      const remove = items.some((item) => item.emoji === emoji && item.reacted);
      const result = await api.authenticated<{ items: ReactionItem[] }>(
        `${path}/reaction`,
        remove ? undefined : { emoji },
        remove ? 'DELETE' : 'PUT',
      );
      rememberReaction(cacheKey, result.items, revision);
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
  return { items, busy, error, react };
}

export function MessageReactions({
  message,
  open,
  onClose,
  controller,
}: {
  message: Message;
  open: boolean;
  onClose: () => void;
  controller: MessageReactionController;
}) {
  const { items, busy, error, react } = controller;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [open]);
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
                {MESSAGE_REACTION_EMOJIS.map(({ emoji, name }) => (
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
