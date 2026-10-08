import { Injectable, Logger, Module } from '@nestjs/common';

export interface ChatEvent {
  name:
    | 'message:created'
    | 'message:updated'
    | 'message:deleted'
    | 'message:reactions'
    | 'message:receipt'
    | 'typing:update';
  conversationId: string;
  messageId?: string;
  actorId?: string;
  payload: unknown;
}

@Injectable()
export class RealtimeEvents {
  private readonly logger = new Logger(RealtimeEvents.name);
  private listener?: (event: ChatEvent) => void;

  listen(listener: (event: ChatEvent) => void) {
    this.listener = listener;
  }

  close() {
    this.listener = undefined;
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
