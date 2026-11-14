import type { Receipt } from '../../lib/chat-model';

export function ReceiptPanel({
  receipts,
  loading,
  currentUserId,
  names,
  onClose,
}: {
  receipts: Record<string, Receipt> | undefined;
  loading: boolean;
  currentUserId: string;
  names: (id: string) => string;
  onClose: () => void;
}) {
  const others = Object.values(receipts ?? {}).filter(
    (item) => item.userId !== currentUserId,
  );
  return (
    <div className="receipt-panel">
      <div>
        <strong>Trạng thái tin nhắn</strong>
        <button className="retry" onClick={onClose}>
          Đóng
        </button>
      </div>
      {loading ? (
        <p>Đang tải…</p>
      ) : others.length ? (
        <ul>
          {others.map((item) => (
            <li key={item.userId}>
              {names(item.userId)} · {item.readAt ? 'Đã đọc' : 'Đã nhận'}
              {(item.readAt || item.deliveredAt) && (
                <time>
                  {' '}
                  ·{' '}
                  {new Date((item.readAt ?? item.deliveredAt)!).toLocaleString(
                    'vi-VN',
                  )}
                </time>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>Chưa có xác nhận nhận hoặc đọc.</p>
      )}
    </div>
  );
}
