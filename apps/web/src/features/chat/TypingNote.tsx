import { Avatar } from '../../components/Avatar';
import type { Peer } from '../../lib/types';

export function TypingNote({
  typing,
  names,
  peers = [],
  isGroup = false,
}: {
  typing: Record<string, number>;
  names: (id: string) => string;
  peers?: Peer[];
  isGroup?: boolean;
}) {
  const now = Date.now();
  const activeEntries = Object.entries(typing)
    .filter(([, expiry]) => expiry > now)
    .map(([id]) => ({
      id,
      name: names(id),
      peer: peers.find((item) => item.id === id) ?? {
        displayName: names(id),
      },
    }));

  const label =
    activeEntries.length > 0
      ? `${activeEntries.map((entry) => entry.name).join(', ')} đang nhập…`
      : '';

  return (
    <div className="typing-note" role="status" aria-live="polite">
      {activeEntries.length > 0 ? (
        <>
          <span
            className="message-sender-avatar typing-avatar"
            title={label}
            aria-hidden="true"
          >
            <Avatar peer={activeEntries[0].peer} />
          </span>
          <span className="typing-bubble" title={label}>
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {isGroup ? (
              <span className="typing-label">
                {activeEntries.map((entry) => entry.name).join(', ')}
              </span>
            ) : (
              <span className="typing-sr-only">{label}</span>
            )}
          </span>
        </>
      ) : null}
    </div>
  );
}
