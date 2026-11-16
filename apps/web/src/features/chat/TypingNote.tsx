export function TypingNote({
  typing,
  names,
}: {
  typing: Record<string, number>;
  names: (id: string) => string;
}) {
  const now = Date.now();
  const activeNames = Object.entries(typing)
    .filter(([, expiry]) => expiry > now)
    .map(([id]) => names(id));

  return (
    <div className="typing-note" role="status" aria-live="polite">
      {activeNames.length > 0 ? (
        <>
          <span className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="typing-label">
            {activeNames.join(', ')} đang nhập…
          </span>
        </>
      ) : null}
    </div>
  );
}
