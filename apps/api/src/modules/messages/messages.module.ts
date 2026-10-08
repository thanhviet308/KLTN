import { ChatFilesService } from './chat-files.service';
import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { RealtimeEventsModule } from '../realtime/realtime-events.module';
import { MessageRateLimit } from './message-rate-limit';

@Module({
  imports: [ConversationsModule, RealtimeEventsModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessageRateLimit, ChatFilesService],
  exports: [MessagesService],
})
export class MessagesModule {}
