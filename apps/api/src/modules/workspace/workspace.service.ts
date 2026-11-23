import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Message } from '../database/entities/message.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import {
  decryptMessageText,
  encryptMessageText,
} from '../database/message-encryption';
import { searchTokens } from './search-index';
import type {
  CreatePollDto,
  SearchMessagesDto,
  VoteDto,
} from './workspace.dto';
import type { PageDto } from '../../common/page.dto';
import { RealtimeEvents } from '../realtime/realtime-events.module';

type RawPoll = {
  id: string;
  conversation_id: string;
  creator_id: string;
  question: string;
  options: string | string[];
  multiple: boolean;
  closed_at: Date | null;
  boundary_sequence: string;
  created_at: Date;
};

type Poll = Omit<RawPoll, 'options'> & { options: string[] };

function parseStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function parseNumberArray(val: unknown): number[] {
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(Number);
    } catch {
      return [];
    }
  }
  return [];
}

function normalizePoll(raw: RawPoll): Poll {
  return {
    ...raw,
    options: parseStringArray(raw.options),
  };
}

function fail(code: string, status = 404): never {
  throw new HttpException({ code, message: code }, status);
}

@Injectable()
export class WorkspaceService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private indexing = false;
  private readonly logger = new Logger(WorkspaceService.name);
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(RealtimeEvents) private readonly events: RealtimeEvents,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.indexBatch().catch(() =>
        this.logger.error('SEARCH_INDEX_FAILED'),
      );
    }, 2000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async indexBatch() {
    if (this.indexing) return;
    this.indexing = true;
    try {
      await this.db.transaction(async (manager) => {
        const rows: { id: string; body: string }[] = await manager.query(
          `SELECT TOP (100) m.id, COALESCE(m.edited_body, m.body) AS body
           FROM messages m WITH (UPDLOCK, ROWLOCK, READPAST)
           WHERE m.type = 'text' AND m.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM message_search_index i WHERE i.message_id = m.id)
           ORDER BY m.id`,
        );
        for (const row of rows) {
          const tokensJson = JSON.stringify(
            searchTokens(decryptMessageText(row.body)),
          );
          await manager.query(
            `IF NOT EXISTS (SELECT 1 FROM message_search_index WITH (UPDLOCK, HOLDLOCK) WHERE message_id = @0)
               INSERT INTO message_search_index(message_id, tokens) VALUES (@0, @1)`,
            [row.id, tokensJson],
          );
        }
      });
    } finally {
      this.indexing = false;
    }
  }
  async search(actorId: string, input: SearchMessagesDto) {
    const tokens = searchTokens(input.query);
    if (!tokens.length) return { items: [], nextCursor: null };
    return this.db.transaction(async (manager) => {
      if (input.conversationId)
        await this.conversations.requireAccess(
          manager,
          input.conversationId,
          actorId,
        );
      const query = manager
        .getRepository(Message)
        .createQueryBuilder('message')
        .innerJoin('message_search_index', 'idx', 'idx.message_id = message.id')
        .where(
          "message.deletedAt IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id=message.sender_id AND u.status='active')",
        )
        .andWhere(
          `EXISTS (SELECT 1 FROM conversations c WHERE c.id=message.conversation_id AND c.deleted_at IS NULL
          AND (c.type <> 'direct' OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id IN (c.direct_user_low_id,c.direct_user_high_id) AND u.status <> 'active')))`,
        )
        .andWhere(
          `EXISTS (SELECT 1 FROM conversation_member_periods p WHERE p.conversation_id=message.conversation_id AND p.user_id=:actorId AND p.left_at IS NULL)`,
          { actorId },
        )
        .andWhere(
          `EXISTS (SELECT 1 FROM conversation_member_periods p WHERE p.conversation_id=message.conversation_id AND p.user_id=:actorId
          AND message.sequence>p.joined_after_sequence AND (p.left_after_sequence IS NULL OR message.sequence<=p.left_after_sequence))`,
          { actorId },
        )
        .andWhere(
          `EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=message.conversation_id AND cm.user_id=:actorId
          AND message.sequence>cm.cleared_after_sequence)`,
          { actorId },
        )
        .orderBy('message.id', 'ASC')
        .take(input.limit + 1);
      tokens.forEach((tok, idx) => {
        query.andWhere(`idx.tokens LIKE :tok_${idx}`, {
          [`tok_${idx}`]: `%"${tok}"%`,
        });
      });
      if (input.conversationId)
        query.andWhere('message.conversationId=:id', {
          id: input.conversationId,
        });
      if (input.cursor)
        query.andWhere('message.id>:cursor', { cursor: input.cursor });
      const rows = await query.getMany();
      return {
        items: rows.slice(0, input.limit).map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          body: m.editedBody ?? m.body,
          sequence: m.sequence,
          createdAt: m.createdAt,
        })),
        nextCursor:
          rows.length > input.limit ? rows[input.limit - 1]!.id : null,
      };
    });
  }
  async pins(actorId: string, conversationId: string) {
    await this.db.transaction((manager) =>
      this.conversations.requireAccess(manager, conversationId, actorId),
    );
    const pins: { message_id: string }[] = await this.db.query(
      'SELECT TOP (50) message_id FROM message_pins WHERE conversation_id = @0 ORDER BY created_at DESC',
      [conversationId],
    );
    const items = [];
    for (const pin of pins) {
      try {
        const result = await this.messages.get(
          actorId,
          conversationId,
          pin.message_id,
        );
        if (!result.message.deletedAt) items.push(result.message);
      } catch (e) {
        if (!(e instanceof HttpException) || e.getStatus() !== 404) throw e;
      }
    }
    return { items };
  }
  async pin(
    actorId: string,
    conversationId: string,
    messageId: string,
    remove: boolean,
  ) {
    await this.messages.get(actorId, conversationId, messageId);
    const result = await this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(
        manager,
        conversationId,
        actorId,
        true,
      );
      if (remove)
        await manager.query(
          'DELETE FROM message_pins WHERE message_id = @0 AND conversation_id = @1',
          [messageId, conversationId],
        );
      else {
        const [count] = (await manager.query(
          'SELECT CAST(COUNT(*) AS INT) AS total FROM message_pins WHERE conversation_id = @0',
          [conversationId],
        )) as { total: number }[];
        if (count!.total >= 50) fail('PIN_LIMIT', 409);
        await manager.query(
          `IF NOT EXISTS (SELECT 1 FROM message_pins WITH (UPDLOCK, HOLDLOCK) WHERE message_id = @0 AND conversation_id = @1)
             INSERT INTO message_pins(message_id, conversation_id, user_id) VALUES (@0, @1, @2)`,
          [messageId, conversationId, actorId],
        );
      }
      return { success: true };
    });
    this.events.publish({
      name: 'conversation:pins',
      conversationId,
      payload: { conversationId },
    });
    return result;
  }
  private async pollAccess(
    manager: EntityManager,
    actorId: string,
    conversationId: string,
    pollId: string,
  ) {
    const access = await this.conversations.requireAccess(
      manager,
      conversationId,
      actorId,
      true,
    );
    const rows: RawPoll[] = await manager.query(
      `SELECT p.* FROM group_polls p WITH (UPDLOCK, ROWLOCK) WHERE p.id = @0 AND p.conversation_id = @1
      AND EXISTS (SELECT 1 FROM conversation_member_periods m WHERE m.conversation_id = p.conversation_id AND m.user_id = @2
        AND m.joined_at <= p.created_at AND (m.left_at IS NULL OR m.left_at >= p.created_at))`,
      [pollId, conversationId, actorId],
    );
    if (!rows[0]) fail('POLL_NOT_FOUND');
    return { ...access, poll: normalizePoll(rows[0]) };
  }
  async createPoll(
    actorId: string,
    conversationId: string,
    input: CreatePollDto,
  ) {
    const options = input.options.map((o) => o.trim());
    if (options.some((o) => !o) || new Set(options).size !== options.length)
      fail('INVALID_POLL_OPTIONS', 400);
    return this.db.transaction(async (manager) => {
      const { conversation } = await this.conversations.requireAccess(
        manager,
        conversationId,
        actorId,
        true,
      );
      if (conversation.type !== 'group') fail('GROUP_REQUIRED', 400);
      const existingRows: RawPoll[] = await manager.query(
        'SELECT * FROM group_polls WHERE creator_id = @0 AND client_request_id = @1',
        [actorId, input.clientRequestId],
      );
      if (existingRows[0]) {
        const existing = normalizePoll(existingRows[0]);
        if (
          existing.conversation_id.toLowerCase() !==
            conversationId.toLowerCase() ||
          decryptMessageText(existing.question) !== input.question ||
          JSON.stringify(existing.options.map(decryptMessageText)) !==
            JSON.stringify(options) ||
          Boolean(existing.multiple) !== Boolean(input.multiple)
        )
          fail('POLL_IDEMPOTENCY_CONFLICT', 409);
        return { id: existing.id };
      }
      const [row] = (await manager.query(
        `INSERT INTO group_polls(conversation_id, creator_id, client_request_id, question, options, multiple, boundary_sequence)
         OUTPUT INSERTED.id
         VALUES(@0, @1, @2, @3, @4, @5, @6)`,
        [
          conversationId,
          actorId,
          input.clientRequestId,
          encryptMessageText(input.question),
          JSON.stringify(options.map(encryptMessageText)),
          input.multiple ? 1 : 0,
          conversation.lastMessageSequence,
        ],
      )) as { id: string }[];
      return row;
    });
  }
  async polls(actorId: string, conversationId: string, input: PageDto) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      const rawRows: RawPoll[] = await manager.query(
        `SELECT TOP (@3) p.* FROM group_polls p
         WHERE p.conversation_id = @0 AND (@2 IS NULL OR p.id > CAST(@2 AS UNIQUEIDENTIFIER))
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.creator_id AND u.status = 'active')
         AND EXISTS (SELECT 1 FROM conversation_member_periods m WHERE m.conversation_id = p.conversation_id AND m.user_id = @1
           AND m.joined_at <= p.created_at AND (m.left_at IS NULL OR m.left_at >= p.created_at))
         ORDER BY p.id`,
        [conversationId, actorId, input.cursor ?? null, input.limit + 1],
      );
      const rows = rawRows.map(normalizePoll);
      const items = [];
      for (const row of rows.slice(0, input.limit)) {
        const rawVotes: { user_id: string; options: string | number[] }[] =
          await manager.query(
            "SELECT v.user_id, v.options FROM poll_votes v JOIN users u ON u.id = v.user_id AND u.status = 'active' WHERE poll_id = @0",
            [row.id],
          );
        const votes = rawVotes.map((v) => ({
          user_id: v.user_id,
          options: parseNumberArray(v.options),
        }));
        items.push({
          id: row.id,
          creatorId: row.creator_id,
          question: decryptMessageText(row.question),
          options: row.options.map((value, index) => ({
            text: decryptMessageText(value),
            count: votes.filter((v) => v.options.includes(index)).length,
          })),
          multiple: Boolean(row.multiple),
          closedAt: row.closed_at,
          selected:
            votes.find((v) => v.user_id.toLowerCase() === actorId.toLowerCase())
              ?.options ?? [],
          voters: votes.length,
        });
      }
      return {
        items,
        nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
      };
    });
  }
  async vote(
    actorId: string,
    conversationId: string,
    id: string,
    input: VoteDto,
  ) {
    return this.db.transaction(async (manager) => {
      const { poll } = await this.pollAccess(
        manager,
        actorId,
        conversationId,
        id,
      );
      if (poll.closed_at) fail('POLL_CLOSED', 409);
      if (
        (!poll.multiple && input.options.length > 1) ||
        input.options.some((i) => i >= poll.options.length)
      )
        fail('INVALID_VOTE', 400);
      if (!input.options.length)
        await manager.query(
          'DELETE FROM poll_votes WHERE poll_id = @0 AND user_id = @1',
          [id, actorId],
        );
      else
        await manager.query(
          `MERGE INTO poll_votes WITH (HOLDLOCK) AS target
           USING (SELECT @0 AS poll_id, @1 AS user_id, @2 AS options) AS source
           ON target.poll_id = source.poll_id AND target.user_id = source.user_id
           WHEN MATCHED THEN UPDATE SET options = source.options
           WHEN NOT MATCHED THEN INSERT (poll_id, user_id, options) VALUES (source.poll_id, source.user_id, source.options);`,
          [id, actorId, JSON.stringify(input.options)],
        );
      return { success: true };
    });
  }
  async closePoll(actorId: string, conversationId: string, id: string) {
    return this.db.transaction(async (manager) => {
      const { poll, member } = await this.pollAccess(
        manager,
        actorId,
        conversationId,
        id,
      );
      if (
        poll.creator_id.toLowerCase() !== actorId.toLowerCase() &&
        !['owner', 'admin'].includes(member.role)
      )
        fail('POLL_FORBIDDEN', 403);
      await manager.query(
        'UPDATE group_polls SET closed_at = COALESCE(closed_at, SYSDATETIMEOFFSET()) WHERE id = @0',
        [id],
      );
      return { success: true };
    });
  }
}
