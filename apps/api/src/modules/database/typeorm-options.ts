import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { User } from './entities/user.entity';
import { Session } from './entities/session.entity';
import { SessionRefreshToken } from './entities/session-refresh-token.entity';
import { Friendship } from './entities/friendship.entity';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { ConversationMemberPeriod } from './entities/conversation-member-period.entity';
import { Message } from './entities/message.entity';
import { MessageReceipt } from './entities/message-receipt.entity';
import { Attachment } from './entities/attachment.entity';
import { Call } from './entities/call.entity';
import { CallParticipant } from './entities/call-participant.entity';
import { DeviceToken } from './entities/device-token.entity';
import { Notification } from './entities/notification.entity';
import { AiJob } from './entities/ai-job.entity';
import { Report } from './entities/report.entity';
import { AuditLog } from './entities/audit-log.entity';
import { RegistrationVerification } from './entities/registration-verification.entity';

export function typeormOptions(databaseUrl: string): PostgresConnectionOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    schema: 'public',
    entities: [
      RegistrationVerification,
      User,
      Session,
      SessionRefreshToken,
      Friendship,
      Conversation,
      ConversationMember,
      ConversationMemberPeriod,
      Message,
      MessageReceipt,
      Attachment,
      Call,
      CallParticipant,
      DeviceToken,
      Notification,
      AiJob,
      Report,
      AuditLog,
    ],
    migrations: [resolve(__dirname, 'migrations/*.js')],
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    uuidExtension: 'pgcrypto',
    installExtensions: false,
    logging: false,
    poolErrorHandler: () =>
      Logger.error('PostgreSQL idle connection failed', 'Database'),
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' },
    poolSize: 10,
    extra: {
      connectionTimeoutMillis: 30000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      query_timeout: 6000,
      application_name: 'realtime-chat-api',
      options: '-c timezone=UTC',
    },
  };
}
