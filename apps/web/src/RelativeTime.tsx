import { useEffect, useState } from 'react';

export function relativeTime(value: string, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes}p`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)} ngày`;
}

export function RelativeTime({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = window.setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', update);
    };
  }, []);
  const label = relativeTime(value, now);
  return (
    <time
      dateTime={value}
      className={className}
      aria-label={
        label === 'Vừa xong'
          ? label
          : `${label.replace('p', ' phút').replace('h', ' giờ')} trước`
      }
    >
      {label}
    </time>
  );
}
