const EMOJIS = [
  '😀',
  '😂',
  '🥰',
  '😍',
  '😭',
  '😮',
  '❤️',
  '👍',
  '👋',
  '🎉',
  '🔥',
  '🙏',
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div
      className="composer-emoji-picker"
      role="group"
      aria-label="Biểu tượng cảm xúc"
    >
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={emoji}
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
