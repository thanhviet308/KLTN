import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './modules/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { FriendshipsModule } from './modules/friendships/friendships.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { CallsModule } from './modules/calls/calls.module';
import { AiModule } from './modules/ai/ai.module';
import { MessageRequestsModule } from './modules/message-requests/message-requests.module';
import { GamesModule } from './modules/games/games.module';
import { NotesModule } from './modules/notes/notes.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: resolve(__dirname, '..', '.env'),
      validate: validateEnvironment,
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    FriendshipsModule,
    MessageRequestsModule,
    ConversationsModule,
    MessagesModule,
    RealtimeModule,
    CallsModule,
    AiModule,
    GamesModule,
    NotesModule,
    NotificationsModule,
    ReportsModule,
    WorkspaceModule,
  ],
})
export class AppModule {}
