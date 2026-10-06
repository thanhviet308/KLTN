export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  sequence: string;
  body: string;
  createdAt: string;
}
export interface Receipt {
  messageId: string;
  userId: string;
  deliveredAt: string | null;
  readAt: string | null;
}
export interface History {
  items: Message[];
  nextCursor: string | null;
  highWatermark: string;
}
export function mergeMessages(previous: Message[], incoming: Message[]) {
  const entries = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) entries.set(message.id, message);
  return [...entries.values()].sort((a, b) =>
    BigInt(a.sequence) < BigInt(b.sequence)
      ? -1
      : BigInt(a.sequence) > BigInt(b.sequence)
        ? 1
        : 0,
  );
}
export function mergeReceipt(
  previous: Receipt | undefined,
  next: Receipt,
): Receipt {
  return {
    ...next,
    deliveredAt: previous?.deliveredAt ?? next.deliveredAt,
    readAt: previous?.readAt ?? next.readAt,
  };
}
