export function TypingNote({
  typing,
  names,
}: {
  typing: Record<string, number>;
  names: (id: string) => string;
}) {
  const now = Date.now();
  return (
    <p className="typing-note" aria-live="polite">
      {Object.entries(typing)
        .filter(([, expiry]) => expiry > now)
        .map(([id]) => names(id))
        .join(', ')}
      {Object.values(typing).some((expiry) => expiry > now)
        ? ' đang nhập…'
        : null}
    </p>
  );
}
