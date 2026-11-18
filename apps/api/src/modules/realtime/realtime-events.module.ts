import { Injectable, Logger, Module } from '@nestjs/common';

export interface ChatEvent {
  name:
    | 'message:created'
    | 'message:updated'
    | 'message:deleted'
    | 'message:reactions'
    | 'message:receipt'
    | 'conversation:pins'
    | 'conversation:history-cleared'
    | 'typing:update'
    | 'call:incoming'
    | 'call:updated'
    | 'game:updated';
  conversationId: string;
  messageId?: string;
  actorId?: string;
  targetUserIds?: string[];
  payload: unknown;
}

@Injectable()
export class RealtimeEvents {
  private readonly logger = new Logger(RealtimeEvents.name);
  private listener?: (event: ChatEvent) => void;
  private accessListener?: (userId: string, status?: string) => void;
  private friendshipListener?: (
    userA: string,
    userB: string,
    status: 'accepted' | 'removed',
  ) => void;
  onAccessChange(listener: (userId: string, status?: string) => void) {
    this.accessListener = listener;
  }
  accessChanged(userId: string, status?: string) {
    this.accessListener?.(userId, status);
  }
  onFriendshipChange(
    listener: (
      userA: string,
      userB: string,
      status: 'accepted' | 'removed',
    ) => void,
  ) {
    this.friendshipListener = listener;
  }
  friendshipChanged(
    userA: string,
    userB: string,
    status: 'accepted' | 'removed',
  ) {
    try {
      this.friendshipListener?.(userA, userB, status);
    } catch {
      this.logger.error({ code: 'REALTIME_DELIVERY_FAILED' });
    }
  }

  listen(listener: (event: ChatEvent) => void) {
    this.listener = listener;
  }

  close() {
    this.listener = undefined;
    this.accessListener = undefined;
    this.friendshipListener = undefined;
  }

  // Call only after commit. A delivery failure must not undo a durable write.
  publish(event: ChatEvent) {
    try {
      this.listener?.(event);
    } catch {
      this.logger.error({ code: 'REALTIME_DELIVERY_FAILED' });
    }
  }
}

@Module({ providers: [RealtimeEvents], exports: [RealtimeEvents] })
export class RealtimeEventsModule {}
