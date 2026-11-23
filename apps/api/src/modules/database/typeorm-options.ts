import { resolve } from 'node:path';
import type { SqlServerConnectionOptions } from 'typeorm/driver/sqlserver/SqlServerConnectionOptions';
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
import { PasswordReset } from './entities/password-reset.entity';
import { MessageRequest } from './entities/message-request.entity';
import { GameSession } from './entities/game-session.entity';
import { UserNote } from './entities/user-note.entity';

export function typeormOptions(
  databaseUrl: string,
): SqlServerConnectionOptions {
  const url = new URL(databaseUrl);
  return {
    type: 'mssql',
    host: url.hostname,
    port: Number(url.port || 1433),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    schema: 'dbo',
    options: {
      encrypt: true,
      trustServerCertificate:
        url.searchParams.get('trustServerCertificate') === 'true',
      useUTC: true,
    },
    entities: [
      PasswordReset,
      RegistrationVerification,
      User,
      Session,
      SessionRefreshToken,
      Friendship,
      MessageRequest,
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
      GameSession,
      UserNote,
    ],
    migrations: [resolve(__dirname, 'migrations-sqlserver/*.js')],
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' },
    pool: { max: 10, min: 0 },
    connectionTimeout: 30000,
    requestTimeout: 6000,
  };
}
