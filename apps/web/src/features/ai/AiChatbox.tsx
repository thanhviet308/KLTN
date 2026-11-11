import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, RotateCcw, Copy, Check } from 'lucide-react';
import * as api from '../../lib/api';

interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  suggestions?: string[];
}

const STARTERS = [
  'Viết lời nhắn kết bạn lịch sự',
  'Soạn tin nhắn xin phép đến muộn',
  'PingPong có những tính năng gì?',
];

export function AiChatbox({
  open,
  onClose,
  userName,
  onExpired,
}: {
  open: boolean;
  onClose: () => void;
  userName: string;
  onExpired: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean>();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open || enabled !== undefined) return;
    void api
      .authenticated<{ enabled: boolean }>('/ai/status')
      .then((res) => {
        if (mounted.current) setEnabled(res.enabled);
      })
      .catch((err) => {
        if (!mounted.current) return;
        if (err instanceof api.ApiError && err.status === 401) {
          onExpired();
          return;
        }
        setEnabled(false);
        setError(api.errorMessage(err));
      });
  }, [open, enabled, onExpired]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [turns, busy, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  async function send(textToSend = draft) {
    const clean = textToSend.trim();
    if (!clean || busy || enabled === false) return;
    const userTurn: ChatTurn = {
      id: `${Date.now()}-u`,
      role: 'user',
      text: clean,
    };
    const nextTurns = [...turns, userTurn].slice(-20);
    setTurns(nextTurns);
    if (textToSend === draft) setDraft('');
    setBusy(true);
    setError('');
    try {
      const response = await api.authenticated<{
        result: { reply: string; suggestions: string[] };
      }>(
        '/ai/chat',
        {
          messages: nextTurns.map(({ role, text }) => ({ role, text })),
        },
        'POST',
        35000,
      );
      if (!mounted.current) return;
      setTurns((current) =>
        [
          ...current,
          {
            id: `${Date.now()}-m`,
            role: 'model' as const,
            text: response.result.reply,
            suggestions: response.result.suggestions,
          },
        ].slice(-20),
      );
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof api.ApiError && err.status === 401) {
        onExpired();
        return;
      }
      setError(api.errorMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function copyTurn(turn: ChatTurn) {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopiedId(turn.id);
      window.setTimeout(() => {
        if (mounted.current)
          setCopiedId((current) => (current === turn.id ? undefined : current));
      }, 2000);
    } catch {
      setError('Không thể sao chép tự động. Hãy bôi đen văn bản để sao chép.');
    }
  }

  if (!open) return null;

  const lastModelTurn = [...turns]
    .reverse()
    .find((turn) => turn.role === 'model');

  return (
    <div className="ai-chatbox-root">
      <section
        className="ai-chatbox-panel"
        aria-label="Khung chat Trợ lý PingPong AI"
      >
        <header className="ai-chatbox-header">
          <div className="ai-chatbox-brand">
            <span className="ai-chatbox-avatar" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div>
              <strong>PingPong AI</strong>
              <small>Trợ lý thông minh</small>
            </div>
          </div>
          <div className="ai-chatbox-actions">
            {turns.length > 0 && (
              <button
                type="button"
                className="ai-icon-button"
                title="Làm mới cuộc trò chuyện"
                aria-label="Làm mới cuộc trò chuyện"
                disabled={busy}
                onClick={() => {
                  setTurns([]);
                  setError('');
                }}
              >
                <RotateCcw size={16} />
              </button>
            )}
            <button
              type="button"
              className="ai-icon-button"
              title="Đóng khung chat AI"
              aria-label="Đóng khung chat AI"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="ai-chatbox-messages" ref={listRef}>
          {enabled === false && (
            <p className="ai-notice" role="status">
              Trợ lý AI hiện chưa sẵn sàng. Vui lòng thử lại sau.
            </p>
          )}
          {turns.length === 0 ? (
            <div className="ai-chatbox-welcome">
              <p>
                Xin chào <strong>{userName}</strong>! Mình có thể giúp bạn soạn
                tin nhắn, dịch thuật, lên ý tưởng hoặc giải đáp thắc mắc ngay
                tại đây.
              </p>
              <div className="ai-chatbox-starters">
                {STARTERS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={busy || enabled === false}
                    onClick={() => void send(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={`ai-chatbox-turn ${turn.role === 'user' ? 'user' : 'model'}`}
              >
                <div className="ai-chatbox-bubble">
                  <p>{turn.text}</p>
                  {turn.role === 'model' && (
                    <button
                      type="button"
                      className="ai-chatbox-copy"
                      onClick={() => void copyTurn(turn)}
                    >
                      {copiedId === turn.id ? (
                        <>
                          <Check size={13} aria-hidden="true" /> Đã sao chép
                        </>
                      ) : (
                        <>
                          <Copy size={13} aria-hidden="true" /> Sao chép
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          {busy && (
            <div className="ai-chatbox-turn model" role="status">
              <div className="ai-chatbox-bubble typing">
                <span>PingPong AI đang trả lời…</span>
              </div>
            </div>
          )}
          {!busy &&
            lastModelTurn?.suggestions &&
            lastModelTurn.suggestions.length > 0 && (
              <div className="ai-chatbox-suggestions">
                {lastModelTurn.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <form
          className="ai-chatbox-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            maxLength={4000}
            disabled={busy || enabled === false}
            value={draft}
            placeholder="Hỏi PingPong AI hoặc nhờ soạn tin nhắn…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="submit"
            aria-label="Gửi cho PingPong AI"
            disabled={busy || enabled === false || !draft.trim()}
          >
            <Send size={16} aria-hidden="true" />
          </button>
        </form>
      </section>
    </div>
  );
}
