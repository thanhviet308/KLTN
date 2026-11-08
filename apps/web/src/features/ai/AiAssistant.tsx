import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Copy } from 'lucide-react';
import * as api from '../../lib/api';
import type { Message } from '../../lib/chat-model';
import {
  initialSelection,
  sourceRevision,
  sourceVersion,
  textMessages,
  type AiKind,
  type AiResult,
} from './ai-model';

const titles = {
  summary: 'Tóm tắt hội thoại',
  replies: 'Gợi ý trả lời',
  translate: 'Dịch tin nhắn',
};
export function AiAssistant({
  conversationId,
  messages,
  kind,
  targetId,
  initialSelectedIds,
  quickStart = false,
  names,
  onClose,
  onDraft,
  onTranslation,
  onLoadOlder,
  loadingOlder,
}: {
  conversationId: string;
  messages: Message[];
  kind: AiKind;
  targetId?: string;
  initialSelectedIds?: string[];
  quickStart?: boolean;
  names: (id: string) => string;
  onClose: () => void;
  onDraft: (text: string) => void;
  onTranslation: (message: Message, value: string, language: string) => void;
  onLoadOlder?: () => void;
  loadingOlder: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const resultPanel = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const autoRequested = useRef(false);
  const latest = useRef(messages);
  latest.current = messages;
  const [selected, setSelected] = useState(() =>
    initialSelectedIds?.length
      ? textMessages(messages)
          .filter((message) => initialSelectedIds.includes(message.id))
          .slice(-50)
          .map((message) => message.id)
      : initialSelection(messages, kind, targetId),
  );
  const [tone, setTone] = useState('concise');
  const [language, setLanguage] = useState('vi');
  const [consent, setConsent] = useState(quickStart);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [output, setOutput] = useState<{
    result: AiResult;
    sources: Message[];
  }>();
  useEffect(() => {
    if (output) resultPanel.current?.focus();
  }, [output]);
  useEffect(() => {
    alive.current = true;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    void api
      .authenticated<{ enabled: boolean }>('/ai/status')
      .then((result) => {
        if (alive.current) setEnabled(result.enabled);
      })
      .catch((failure) => {
        if (alive.current) {
          setEnabled(false);
          setError(api.errorMessage(failure));
        }
      });
    return () => {
      alive.current = false;
      dialog.current?.close();
      previouslyFocused?.focus();
    };
  }, []);
  const texts = textMessages(messages);
  const sources = texts.filter((item) => selected.includes(item.id));
  const chars = sources.reduce(
    (sum, item) => sum + (item.body?.length ?? 0) + names(item.senderId).length,
    0,
  );
  const stale =
    !!output &&
    output.sources.some((source) => {
      const current = messages.find((item) => item.id === source.id);
      return (
        !current ||
        !!current.deletedAt ||
        sourceVersion(source) !== sourceVersion(current)
      );
    });
  const resetOutput = () => {
    setConsent(false);
    setOutput(undefined);
    setCopied(false);
    setError('');
  };
  function chooseRange() {
    const start = from ? new Date(from).getTime() : -Infinity;
    const end = to ? new Date(to).getTime() : Infinity;
    if (start > end) {
      setError('Thời điểm bắt đầu cần trước thời điểm kết thúc.');
      return;
    }
    const filtered = texts.filter(
      (item) =>
        Date.parse(item.createdAt) >= start &&
        Date.parse(item.createdAt) <= end,
    );
    if (filtered.length > 50) {
      setError('Khoảng thời gian có hơn 50 tin. Hãy chọn khoảng ngắn hơn.');
      return;
    }
    setSelected(filtered.map((item) => item.id));
    resetOutput();
  }
  async function generate() {
    if (
      lock.current ||
      !consent ||
      !enabled ||
      !sources.length ||
      sources.length > 50 ||
      chars > 24000
    )
      return;
    const snapshot = sources.map((item) => ({ ...item }));
    lock.current = true;
    setBusy(true);
    setError('');
    setOutput(undefined);
    try {
      const sourceRevisions = await Promise.all(snapshot.map(sourceRevision));
      if (!alive.current) return;
      const response = await api.authenticated<{ result: AiResult }>(
        `/conversations/${conversationId}/ai`,
        {
          kind,
          messageIds: snapshot.map((item) => item.id),
          sourceRevisions,
          tone,
          language,
          ...(kind === 'replies' ? { targetMessageId: targetId } : {}),
        },
        'POST',
        35000,
      );
      if (!alive.current) return;
      if (
        snapshot.some((source) => {
          const current = latest.current.find((item) => item.id === source.id);
          return (
            !current ||
            !!current.deletedAt ||
            sourceVersion(source) !== sourceVersion(current)
          );
        })
      ) {
        setError('Tin nhắn đã thay đổi. Hãy kiểm tra và tạo lại kết quả.');
        return;
      }
      setOutput({ result: response.result, sources: snapshot });
      if (kind === 'translate')
        onTranslation(snapshot[0], response.result.translation, language);
    } catch (failure) {
      if (alive.current) setError(api.errorMessage(failure));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!quickStart || enabled !== true || autoRequested.current) return;
    autoRequested.current = true;
    void generate();
  }, [enabled, quickStart]);
  async function copy() {
    if (!output || stale) return;
    const result = output.result;
    const text =
      kind === 'translate'
        ? result.translation
        : kind === 'replies'
          ? result.replies.join('\n\n')
          : [
              result.summary,
              'Quyết định',
              ...result.decisions,
              'Việc cần làm',
              ...result.tasks,
            ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError(
        'Không thể sao chép. Bạn có thể chọn và sao chép nội dung trực tiếp.',
      );
    }
  }
  return (
    <dialog
      className="ai-dialog"
      ref={dialog}
      aria-labelledby="ai-title"
      onCancel={onClose}
    >
      <header>
        <div>
          <span className="ai-eyebrow">
            <Sparkles size={16} aria-hidden="true" /> PINGPONG AI
          </span>
          <h2 id="ai-title">{titles[kind]}</h2>
        </div>
        <button
          type="button"
          className="ai-icon-button"
          aria-label="Đóng trợ lý AI"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <p className="ai-description">
        {quickStart
          ? `Đang tóm tắt ${sources.length} tin nhắn chưa đọc.`
          : kind === 'summary'
            ? 'Chọn nội dung để tổng hợp ý chính, quyết định và việc cần làm.'
            : kind === 'replies'
              ? 'Chọn ngữ cảnh cần thiết. Bạn có thể sửa gợi ý trước khi gửi.'
              : 'Bản dịch hiển thị dưới tin nhắn và giữ nguyên nội dung gốc.'}
      </p>
      {enabled === false && (
        <p className="ai-notice" role="status">
          Trợ lý AI hiện chưa sẵn sàng. Vui lòng thử lại sau.
        </p>
      )}
      {enabled === undefined && <p role="status">Đang kiểm tra trợ lý AI…</p>}
      {!quickStart && (
        <fieldset disabled={busy}>
          {kind === 'summary' && (
            <div className="ai-range">
              <label>
                Từ
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                Đến
                <input
                  type="datetime-local"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <button type="button" className="retry" onClick={chooseRange}>
                Chọn theo thời gian
              </button>
            </div>
          )}
          <div className="ai-selection-heading">
            <strong>Nội dung gửi cho AI · {sources.length}/50 tin</strong>
            {kind === 'summary' && (
              <button
                type="button"
                className="retry"
                onClick={() => {
                  setSelected([]);
                  resetOutput();
                }}
              >
                Bỏ chọn
              </button>
            )}
          </div>
          <p className="ai-hint">
            Chỉ các tin văn bản được chọn bên dưới sẽ được gửi. Danh sách gồm
            các tin đã tải trong cuộc trò chuyện.
          </p>
          <div className="ai-source-list">
            {(kind === 'summary'
              ? texts
              : texts.filter((item) =>
                  initialSelection(messages, kind, targetId).includes(item.id),
                )
            ).map((item) => (
              <label key={item.id} className="ai-source">
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  disabled={
                    kind === 'translate' ||
                    item.id === targetId ||
                    (!selected.includes(item.id) && selected.length >= 50)
                  }
                  onChange={(event) => {
                    setSelected((previous) =>
                      event.target.checked
                        ? [...previous, item.id]
                        : previous.filter((id) => id !== item.id),
                    );
                    resetOutput();
                  }}
                />
                <span>
                  <span className="ai-source-meta">
                    {names(item.senderId)} ·{' '}
                    {new Date(item.createdAt).toLocaleString('vi-VN')}
                  </span>
                  <span className="ai-source-text">{item.body}</span>
                </span>
              </label>
            ))}
            {!texts.length && <p>Chưa có tin nhắn văn bản để xử lý.</p>}
          </div>
          {kind === 'summary' && onLoadOlder && (
            <button
              className="retry"
              type="button"
              disabled={loadingOlder}
              onClick={onLoadOlder}
            >
              {loadingOlder ? 'Đang tải…' : 'Tải thêm tin cũ để chọn'}
            </button>
          )}
          {kind === 'replies' && (
            <label className="ai-setting">
              Giọng văn
              <select
                value={tone}
                onChange={(event) => {
                  setTone(event.target.value);
                  resetOutput();
                }}
              >
                <option value="concise">Ngắn gọn</option>
                <option value="friendly">Thân thiện</option>
                <option value="formal">Trang trọng</option>
              </select>
            </label>
          )}
          {kind === 'translate' && (
            <label className="ai-setting">
              Dịch sang
              <select
                value={language}
                onChange={(event) => {
                  setLanguage(event.target.value);
                  resetOutput();
                }}
              >
                {Object.entries({
                  vi: 'Tiếng Việt',
                  en: 'Tiếng Anh',
                  ja: 'Tiếng Nhật',
                  ko: 'Tiếng Hàn',
                  zh: 'Tiếng Trung',
                  fr: 'Tiếng Pháp',
                }).map(([code, title]) => (
                  <option key={code} value={code}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ai-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              Tôi đồng ý gửi các tin đã chọn tới Google Gemini để xử lý yêu cầu
              này.
            </span>
          </label>
          {chars > 24000 && (
            <p role="alert" className="ai-error">
              Nội dung quá dài. Hãy bỏ chọn một số tin nhắn.
            </p>
          )}
          <button
            type="button"
            className="ai-generate"
            disabled={
              busy ||
              !enabled ||
              !consent ||
              !sources.length ||
              sources.length > 50 ||
              chars > 24000
            }
            onClick={() => void generate()}
          >
            <Sparkles size={18} aria-hidden="true" />
            {busy ? 'Đang xử lý…' : titles[kind]}
          </button>
        </fieldset>
      )}
      {busy && (
        <p role="status" className="ai-hint">
          AI đang xử lý. Bạn có thể đóng cửa sổ; kết quả sẽ không tự gửi vào
          chat.
        </p>
      )}
      {error && (
        <div role="alert" className="ai-error">
          <p>{error}</p>
          {quickStart && (
            <button
              type="button"
              className="retry"
              disabled={busy || !enabled}
              onClick={() => void generate()}
            >
              Thử lại
            </button>
          )}
        </div>
      )}
      {stale && (
        <p role="alert" className="ai-error">
          Tin nguồn đã thay đổi hoặc bị thu hồi. Hãy tạo lại kết quả.
        </p>
      )}
      {output && !stale && (
        <section
          className="ai-result"
          aria-label="Kết quả AI"
          ref={resultPanel}
          tabIndex={-1}
        >
          <div className="ai-selection-heading">
            <h3>Kết quả</h3>
            <button type="button" className="retry" onClick={() => void copy()}>
              <Copy size={15} aria-hidden="true" />{' '}
              {copied ? 'Đã sao chép' : 'Sao chép'}
            </button>
          </div>
          {kind === 'summary' && (
            <>
              <p>{output.result.summary}</p>
              <h4>Quyết định</h4>
              {output.result.decisions.length ? (
                <ul>
                  {output.result.decisions.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              ) : (
                <p>Chưa có quyết định được nêu rõ.</p>
              )}
              <h4>Việc cần làm</h4>
              {output.result.tasks.length ? (
                <ul>
                  {output.result.tasks.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              ) : (
                <p>Chưa có việc cần làm được nêu rõ.</p>
              )}
            </>
          )}
          {kind === 'replies' && (
            <div className="ai-suggestions">
              {output.result.replies.map((reply, index) => (
                <div key={index}>
                  <p>{reply}</p>
                  <button
                    type="button"
                    className="retry"
                    onClick={() => onDraft(reply)}
                  >
                    Dùng gợi ý này
                  </button>
                </div>
              ))}
            </div>
          )}
          {kind === 'translate' && <p>{output.result.translation}</p>}
          <p className="ai-hint">
            Nội dung do AI tạo có thể có sai sót. Hãy kiểm tra trước khi sử
            dụng.
          </p>
        </section>
      )}
    </dialog>
  );
}
