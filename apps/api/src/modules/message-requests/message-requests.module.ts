import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { RealtimeEventsModule } from '../realtime/realtime-events.module';
import { MessageRequestsController } from './message-requests.controller';
import { MessageRequestsService } from './message-requests.service';

@Module({
  imports: [ConversationsModule, RealtimeEventsModule],
  controllers: [MessageRequestsController],
  providers: [MessageRequestsService],
})
export class MessageRequestsModule {}
