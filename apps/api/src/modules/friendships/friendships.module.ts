import { ConversationsModule } from '../conversations/conversations.module';
import { Module } from '@nestjs/common';
import { RealtimeEventsModule } from '../realtime/realtime-events.module';
import { FriendshipsController } from './friendships.controller';
import { FriendshipsService } from './friendships.service';

@Module({
  imports: [ConversationsModule, RealtimeEventsModule],
  controllers: [FriendshipsController],
  providers: [FriendshipsService],
})
export class FriendshipsModule {}
