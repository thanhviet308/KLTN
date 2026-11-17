import { Module } from '@nestjs/common';
import { RealtimeEventsModule } from '../realtime/realtime-events.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [RealtimeEventsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
