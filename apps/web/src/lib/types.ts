/** A user as shown in conversation/friend lists. */
export interface Peer {
  avatarUrl?: string | null;
  id: string;
  displayName: string;
  friendshipStatus?: 'none' | 'friends' | 'incoming' | 'outgoing';
}

/** Cursor-paginated API response. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
