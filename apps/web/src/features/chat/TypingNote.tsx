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
          <span className="typing-avatars" title={label} aria-hidden="true">
            {activeEntries.slice(0, 2).map((entry) => (
              <span
                key={entry.id}
                className="message-sender-avatar typing-avatar"
              >
                <Avatar peer={entry.peer} />
              </span>
            ))}
          </span>
          <span className="typing-bubble-wrap">
            <span className="typing-bubble" title={label}>
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="typing-sr-only">{label}</span>
            </span>
            {isGroup && (
              <small className="typing-group-caption" aria-hidden="true">
                {label}
              </small>
            )}
          </span>
        </>
      ) : null}
    </div>
  );
}
