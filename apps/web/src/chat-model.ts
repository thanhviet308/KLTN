export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  sequence: string;
  body: string | null;
  type?: 'text' | 'image' | 'file' | 'voice' | 'location';
  content?: {
    attachmentId?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    latitude?: number;
    longitude?: number;
  } | null;
  editedAt?: string | null;
  deletedAt?: string | null;
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
  for (const message of incoming) {
    const existing = entries.get(message.id);
    // A delayed history response must not undo an edit or restore a deleted message.
    if (existing?.deletedAt && !message.deletedAt) continue;
    const version = (item: Message) =>
      Date.parse(item.deletedAt ?? item.editedAt ?? item.createdAt);
    if (existing && version(existing) > version(message)) continue;
    entries.set(message.id, message);
  }
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

export function messageSummary(message: Message) {
  if (message.deletedAt) return 'Tin nhắn đã thu hồi';
  if (message.body) return message.body;
  if (message.type === 'location') return 'Vị trí được chia sẻ';
  if (message.type === 'voice') return 'Tin nhắn thoại';
  return (
    message.content?.fileName ??
    (message.type === 'image' ? 'Ảnh' : 'Tệp đính kèm')
  );
}
