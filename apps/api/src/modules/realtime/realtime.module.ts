import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { ChatGateway } from './chat.gateway';
import { RealtimeEventsModule } from './realtime-events.module';

@Module({
  imports: [AuthModule, MessagesModule, RealtimeEventsModule],
  providers: [ChatGateway],
})
export class RealtimeModule {}
