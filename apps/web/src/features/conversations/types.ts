import type { Message } from '../../lib/chat-model';
import type { Peer } from '../../lib/types';

export type Role = 'owner' | 'admin' | 'member';

export interface Member {
  id: string;
  user: Peer;
  role: Role;
}

export interface Conversation {
  unreadCount?: number;
  lastMessage?: {
    id: string;
    senderId: string;
    senderName?: string;
    sequence: string;
    type?: Message['type'];
    body: string | null;
    content?: Message['content'];
    createdAt: string;
    deletedAt?: string | null;
  } | null;
  peer?: Peer | null;
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  membership: { role: Role; lastReadSequence: string };
  lastMessageSequence: string;
  createdAt: string;
  updatedAt?: string;
}

export type ConversationCategory = 'all' | 'unread' | 'group';

export const roles: Record<Role, string> = {
  owner: 'Chủ nhóm',
  admin: 'Quản trị viên',
  member: 'Thành viên',
};

const FALLBACK_TITLE = 'Trò chuyện riêng';

export function conversationTitle(
  item: Conversation,
  directNames: Record<string, string>,
) {
  return item.title ?? directNames[item.id] ?? FALLBACK_TITLE;
}

/** Applies the category and text filters, newest conversation first. */
export function visibleConversations(
  items: Conversation[],
  category: ConversationCategory,
  filter: string,
  directNames: Record<string, string>,
) {
  const time = (item: Conversation) =>
    Date.parse(item.updatedAt ?? item.lastMessage?.createdAt ?? item.createdAt);
  const needle = filter.toLocaleLowerCase('vi');
  return items
    .filter(
      (item) =>
        category === 'all' ||
        (category === 'unread' ? !!item.unreadCount : item.type === 'group'),
    )
    .sort((a, b) => time(b) - time(a) || b.id.localeCompare(a.id))
    .filter((item) =>
      conversationTitle(item, directNames)
        .toLocaleLowerCase('vi')
        .includes(needle),
    );
}
