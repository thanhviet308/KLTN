import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pin, Search, Sparkles } from 'lucide-react';
import { UiIcon } from '../../components/UiIcon';

export interface HeaderOverflowSheetProps {
  open: boolean;
  title: string;
  isGroup: boolean;
  aiChatOpen: boolean;
  canToggleAi: boolean;
  workspacePanel?: 'search' | 'group';
  showInfo: boolean;
  onClose: () => void;
  onToggleAi: () => void;
  onToggleSearch: () => void;
  onTogglePins: () => void;
  onToggleInfo: () => void;
}

interface OverflowActionItem {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onSelect: () => void;
}

export function HeaderOverflowSheet({
  open,
  title,
  isGroup,
  aiChatOpen,
  canToggleAi,
  workspacePanel,
  showInfo,
  onClose,
  onToggleAi,
  onToggleSearch,
  onTogglePins,
  onToggleInfo,
}: HeaderOverflowSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const actions: OverflowActionItem[] = [
    ...(canToggleAi
      ? [
          {
            id: 'ai',
            label: 'Trợ lý PingPong AI',
            icon: <Sparkles size={18} aria-hidden="true" />,
            active: aiChatOpen,
            onSelect: onToggleAi,
          },
        ]
      : []),
    {
      id: 'search',
      label: 'Tìm trong cuộc trò chuyện',
      icon: <Search size={18} aria-hidden="true" />,
      active: workspacePanel === 'search',
      onSelect: onToggleSearch,
    },
    {
      id: 'pins',
      label: isGroup ? 'Ghim & bình chọn' : 'Tin nhắn đã ghim',
      icon: <Pin size={18} aria-hidden="true" />,
      active: workspacePanel === 'group',
      onSelect: onTogglePins,
    },
    {
      id: 'info',
      label: showInfo ? 'Quay lại đoạn chat' : 'Thông tin cuộc trò chuyện',
      icon: <UiIcon name="info" size={18} />,
      active: showInfo,
      onSelect: onToggleInfo,
    },
  ];

  return createPortal(
    <div
      className="message-sheet-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="message-bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Tiện ích cuộc trò chuyện"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="message-sheet-handle" aria-hidden="true" />
        <div className="message-sheet-preview">
          <strong>{title}</strong>
          <span>
            {isGroup ? 'Tiện ích trò chuyện nhóm' : 'Tiện ích cuộc trò chuyện'}
          </span>
        </div>
        <div className="message-sheet-actions">
          {actions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`message-sheet-item${item.active ? ' is-active' : ''}`}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <span className="message-sheet-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
              {item.active && (
                <span className="message-sheet-badge">Đang mở</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
