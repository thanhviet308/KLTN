export type CallType = 'audio' | 'video';
export interface Call {
  id: string;
  conversationId: string;
  initiatorId: string;
  type: CallType;
  status: 'ringing' | 'active' | 'ended' | 'rejected' | 'missed' | 'cancelled';
  ringExpiresAt: string;
  startedAt: string | null;
  updatedAt: string;
  participants: { userId: string; status: string }[];
}

export function isOpen(call: Call) {
  return call.status === 'ringing' || call.status === 'active';
}

export function canJoin(call: Call, userId: string) {
  return (
    isOpen(call) &&
    call.participants.some(
      peer =>
        peer.userId === userId && ['accepted', 'joined'].includes(peer.status),
    )
  );
}

export function isInvited(call: Call, userId: string) {
  return (
    call.status === 'ringing' &&
    call.initiatorId !== userId &&
    call.participants.some(
      peer => peer.userId === userId && peer.status === 'invited',
    )
  );
}

// Polling and socket events can arrive in either order. Never reopen a finished call.
export function applyCall(current: Call | undefined, next: Call) {
  if (!current) return next;
  if (current.id !== next.id) return isOpen(current) ? current : next;
  if (!isOpen(current) && isOpen(next)) return current;
  if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt))
    return current;
  return next;
}

export function hangupAction(call: Call, userId: string) {
  if (isInvited(call, userId)) return 'reject';
  return call.initiatorId === userId ? 'end' : 'leave';
}
