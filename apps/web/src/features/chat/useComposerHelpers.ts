import { useEffect, useRef, useState } from 'react';

/** Closes a popover on outside pointer-down or Escape while it is open. */
export function useDismissOnOutside(
  open: boolean,
  close: () => void,
  insideSelector: string,
) {
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(insideSelector)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
}

/** Grows a textarea with its content between 38px and 140px. */
export function useAutoResizeTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.style.height = '38px';
    input.style.height = `${Math.min(140, Math.max(38, input.scrollHeight))}px`;
  }, [value]);
  return ref;
}

/** True once the realtime connection has been down for delayMs. */
export function useConnectionDelayed(connected: boolean, delayMs = 8000) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    setDelayed(false);
    if (connected) return;
    const timer = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(timer);
  }, [connected, delayMs]);
  return delayed;
}
