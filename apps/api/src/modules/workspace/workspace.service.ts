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

type Poll = {
  id: string;
  conversation_id: string;
  creator_id: string;
  question: string;
  options: string[];
  multiple: boolean;
  closed_at: Date | null;
  boundary_sequence: string;
  created_at: Date;
};
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
        const rows: { id: string; body: string }[] =
          await manager.query(`SELECT m.id, COALESCE(m.edited_body,m.body) AS body FROM messages m
          WHERE m.type = 'text' AND m.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM message_search_index i WHERE i.message_id=m.id)
          ORDER BY m.id LIMIT 100 FOR UPDATE OF m SKIP LOCKED`);
        for (const row of rows)
          await manager.query(
            'INSERT INTO message_search_index(message_id,tokens) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [row.id, searchTokens(decryptMessageText(row.body))],
          );
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
        .where('idx.tokens @> :tokens::text[]', { tokens })
        .andWhere(
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
        .orderBy('message.id', 'ASC')
        .take(input.limit + 1);
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
      'SELECT message_id FROM message_pins WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 50',
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
    return this.db.transaction(async (manager) => {
      const { member } = await this.conversations.requireAccess(
        manager,
        conversationId,
        actorId,
        true,
      );
      if (!['admin', 'owner'].includes(member.role))
        fail('GROUP_MANAGER_REQUIRED', 403);
      if (remove)
        await manager.query(
          'DELETE FROM message_pins WHERE message_id=$1 AND conversation_id=$2',
          [messageId, conversationId],
        );
      else {
        const [count] = (await manager.query(
          'SELECT count(*)::int AS total FROM message_pins WHERE conversation_id=$1',
          [conversationId],
        )) as { total: number }[];
        if (count!.total >= 50) fail('PIN_LIMIT', 409);
        await manager.query(
          'INSERT INTO message_pins(message_id,conversation_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [messageId, conversationId, actorId],
        );
      }
      return { success: true };
    });
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
    const rows: Poll[] = await manager.query(
      `SELECT p.* FROM group_polls p WHERE p.id=$1 AND p.conversation_id=$2
      AND EXISTS (SELECT 1 FROM conversation_member_periods m WHERE m.conversation_id=p.conversation_id AND m.user_id=$3
        AND m.joined_at<=p.created_at AND (m.left_at IS NULL OR m.left_at>=p.created_at)) FOR UPDATE`,
      [pollId, conversationId, actorId],
    );
    if (!rows[0]) fail('POLL_NOT_FOUND');
    return { ...access, poll: rows[0] };
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
      const existing: Poll[] = await manager.query(
        'SELECT * FROM group_polls WHERE creator_id=$1 AND client_request_id=$2',
        [actorId, input.clientRequestId],
      );
      if (existing[0]) {
        if (
          existing[0].conversation_id !== conversationId ||
          decryptMessageText(existing[0].question) !== input.question ||
          JSON.stringify(existing[0].options.map(decryptMessageText)) !==
            JSON.stringify(options) ||
          existing[0].multiple !== input.multiple
        )
          fail('POLL_IDEMPOTENCY_CONFLICT', 409);
        return { id: existing[0].id };
      }
      const [row] = (await manager.query(
        `INSERT INTO group_polls(conversation_id,creator_id,client_request_id,question,options,multiple,boundary_sequence)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          conversationId,
          actorId,
          input.clientRequestId,
          encryptMessageText(input.question),
          JSON.stringify(options.map(encryptMessageText)),
          input.multiple,
          conversation.lastMessageSequence,
        ],
      )) as { id: string }[];
      return row;
    });
  }
  async polls(actorId: string, conversationId: string, input: PageDto) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      const rows: Poll[] = await manager.query(
        `SELECT p.* FROM group_polls p WHERE p.conversation_id=$1 AND ($3::uuid IS NULL OR p.id>$3)
        AND EXISTS (SELECT 1 FROM users u WHERE u.id=p.creator_id AND u.status='active')
        AND EXISTS (SELECT 1 FROM conversation_member_periods m WHERE m.conversation_id=p.conversation_id AND m.user_id=$2
          AND m.joined_at<=p.created_at AND (m.left_at IS NULL OR m.left_at>=p.created_at)) ORDER BY p.id LIMIT $4`,
        [conversationId, actorId, input.cursor ?? null, input.limit + 1],
      );
      const items = [];
      for (const row of rows.slice(0, input.limit)) {
        const votes: { user_id: string; options: number[] }[] =
          await manager.query(
            "SELECT v.user_id,v.options FROM poll_votes v JOIN users u ON u.id=v.user_id AND u.status='active' WHERE poll_id=$1",
            [row.id],
          );
        items.push({
          id: row.id,
          creatorId: row.creator_id,
          question: decryptMessageText(row.question),
          options: row.options.map((value, index) => ({
            text: decryptMessageText(value),
            count: votes.filter((v) => v.options.includes(index)).length,
          })),
          multiple: row.multiple,
          closedAt: row.closed_at,
          selected: votes.find((v) => v.user_id === actorId)?.options ?? [],
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
          'DELETE FROM poll_votes WHERE poll_id=$1 AND user_id=$2',
          [id, actorId],
        );
      else
        await manager.query(
          'INSERT INTO poll_votes(poll_id,user_id,options) VALUES($1,$2,$3) ON CONFLICT(poll_id,user_id) DO UPDATE SET options=EXCLUDED.options',
          [id, actorId, input.options],
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
        poll.creator_id !== actorId &&
        !['owner', 'admin'].includes(member.role)
      )
        fail('POLL_FORBIDDEN', 403);
      await manager.query(
        'UPDATE group_polls SET closed_at=COALESCE(closed_at,now()) WHERE id=$1',
        [id],
      );
      return { success: true };
    });
  }
}
