import { ShieldAlert } from 'lucide-react';

export function SpamWarning({ score }: { score: number }) {
  const risk = new Intl.NumberFormat('vi-VN', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(score);

  return (
    <div className="spam-warning" role="status">
      <ShieldAlert size={18} aria-hidden="true" />
      <span>
        <strong>Tin nhắn có dấu hiệu đáng ngờ</strong>
        <small>
          Điểm rủi ro {risk}. Không cung cấp mật khẩu, mã OTP hoặc chuyển tiền
          khi chưa xác minh người gửi.
        </small>
      </span>
    </div>
  );
}
