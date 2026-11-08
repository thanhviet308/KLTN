export function TranslationNote({
  language,
  text,
  onHide,
}: {
  language: string;
  text: string;
  onHide: () => void;
}) {
  return (
    <div className="message-translation">
      <span>Bản dịch · {language.toUpperCase()}</span>
      <p>{text}</p>
      <button type="button" onClick={onHide}>
        Ẩn bản dịch
      </button>
    </div>
  );
}
