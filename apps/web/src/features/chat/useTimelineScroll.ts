import { useLayoutEffect, useRef } from 'react';

/**
 * Keeps a message timeline pinned to the latest message until the reader
 * deliberately scrolls away.
 */
export function useTimelineScroll({
  active,
  conversationId,
  loading,
  dependencies,
}: {
  active: boolean;
  conversationId: string;
  loading: boolean;
  /** Values (messages, pending drafts...) whose change should re-follow. */
  dependencies: unknown[];
}) {
  const list = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const initialScrollPending = useRef(true);
  const manualScrollUntil = useRef(0);

  useLayoutEffect(() => {
    if (active) {
      nearBottom.current = true;
      initialScrollPending.current = true;
      manualScrollUntil.current = 0;
    }
  }, [active, conversationId]);

  useLayoutEffect(() => {
    const container = list.current;
    if (!active || !container) return;
    const followLatest = () => {
      if (
        (nearBottom.current || initialScrollPending.current) &&
        container.clientHeight > 0
      )
        container.scrollTop = container.scrollHeight;
    };
    followLatest();
    let firstFrame = 0;
    let secondFrame = 0;
    if (!loading && initialScrollPending.current) {
      // Let the loaded history and media placeholders finish layout before
      // treating scroll events as deliberate reader navigation.
      firstFrame = requestAnimationFrame(() => {
        followLatest();
        secondFrame = requestAnimationFrame(() => {
          followLatest();
          initialScrollPending.current = false;
        });
      });
    }
    // Images and composer/layout changes can resize after messages render.
    // Keep following the bottom only while the reader has not scrolled away.
    const observer = new ResizeObserver(followLatest);
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      observer.disconnect();
    };
  }, [active, conversationId, loading, ...dependencies]);

  /** Event handlers to spread onto the scrollable timeline element. */
  const handlers = {
    onWheel: () => {
      manualScrollUntil.current = Date.now() + 1000;
    },
    onTouchMove: () => {
      manualScrollUntil.current = Date.now() + 1000;
    },
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget)
        manualScrollUntil.current = Date.now() + 2000;
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.buttons) manualScrollUntil.current = Date.now() + 2000;
    },
    onScroll: () => {
      const node = list.current;
      if (
        active &&
        !initialScrollPending.current &&
        Date.now() <= manualScrollUntil.current &&
        node &&
        node.clientHeight > 0
      )
        nearBottom.current =
          node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    },
  };

  return { list, nearBottom, handlers };
}
