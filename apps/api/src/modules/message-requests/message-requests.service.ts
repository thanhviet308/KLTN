import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { pageResult } from '../../common/page.dto';
import { ConversationsService } from '../conversations/conversations.service';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { Friendship } from '../database/entities/friendship.entity';
import { MessageRequest } from '../database/entities/message-request.entity';
import { Message } from '../database/entities/message.entity';
import { User } from '../database/entities/user.entity';
import { RealtimeEvents } from '../realtime/realtime-events.module';
import { publicUserView } from '../users/user-view';
import type {
  CreateMessageRequestDto,
  MessageRequestsQueryDto,
} from './message-requests.dto';

function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

@Injectable()
export class MessageRequestsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
    @Inject(RealtimeEvents) private readonly events: RealtimeEvents,
  ) {}

  private messageView(message: Message) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      clientMessageId: message.clientMessageId,
      sequence: message.sequence,
      type: message.type,
      body: message.deletedAt ? null : (message.editedBody ?? message.body),
      content: message.deletedAt ? null : message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
    };
  }

  private view(
    row: MessageRequest,
    actorId: string,
    conversationId: string | null = null,
  ) {
    const incoming = row.recipientId === actorId;
    return {
      id: row.id,
      conversationId,
      direction: incoming ? ('incoming' as const) : ('outgoing' as const),
      user: publicUserView(incoming ? row.requester : row.recipient),
      body: row.body,
      status: row.status,
      createdAt: row.createdAt,
      respondedAt: row.respondedAt,
    };
  }

  async create(actorId: string, input: CreateMessageRequestDto) {
    if (actorId === input.recipientId)
      fail(400, 'SELF_MESSAGE_REQUEST', 'Cannot message yourself');
    const outcome = await this.db.transaction(async (manager) => {
      const [low, high] = [
        actorId.toLowerCase(),
        input.recipientId.toLowerCase(),
      ].sort() as [string, string];
      await manager.query(
        "EXEC sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Transaction'",
        [`conversation:direct:${low}:${high}`],
      );
      await manager.query(
        "EXEC sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Transaction'",
        [`message-request:${low}:${high}`],
      );
      const users = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .where('user.id IN (:...ids)', { ids: [low, high] })
        .orderBy('user.id', 'ASC')
        .setLock('pessimistic_read')
        .getMany();
      if (users.length !== 2 || users.some((user) => user.status !== 'active'))
        fail(404, 'USER_UNAVAILABLE', 'User is unavailable');

      const friendship = await manager.getRepository(Friendship).findOneBy({
        pairLowId: low,
        pairHighId: high,
        status: 'accepted',
      });
      const repository = manager.getRepository(MessageRequest);
      const existing = await repository.findOne({
        where: { pairLowId: low, pairHighId: high },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        existing.requester = users.find(
          (user) =>
            user.id.toLowerCase() === existing.requesterId.toLowerCase(),
        )!;
        existing.recipient = users.find(
          (user) =>
            user.id.toLowerCase() === existing.recipientId.toLowerCase(),
        )!;
      }

      let savedRequest: MessageRequest | null = existing;
      let syncKind: 'accepted' | 'request_updated' = 'request_updated';
      if (!friendship) {
        const row = existing ?? repository.create();
        if (
          !existing ||
          (existing.status !== 'pending' && existing.status !== 'accepted')
        ) {
          row.requesterId = actorId;
          row.recipientId = input.recipientId;
          row.pairLowId = low;
          row.pairHighId = high;
          row.requester = users.find(
            (user) => user.id.toLowerCase() === actorId.toLowerCase(),
          )!;
          row.recipient = users.find(
            (user) => user.id.toLowerCase() === input.recipientId.toLowerCase(),
          )!;
          row.body = input.body;
          row.status = 'pending';
          row.respondedAt = null;
          savedRequest = await repository.save(row);
        } else if (existing.status === 'pending') {
          if (existing.recipientId.toLowerCase() === actorId.toLowerCase()) {
            existing.status = 'accepted';
            existing.respondedAt = new Date();
            syncKind = 'accepted';
          } else {
            existing.body = input.body;
          }
          savedRequest = await repository.save(existing);
        }
      }

      const direct = await this.conversations.ensureDirect(
        manager,
        actorId,
        input.recipientId,
        false,
      );
      const conversation = await manager.getRepository(Conversation).findOne({
        where: { id: direct.conversation.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conversation)
        fail(409, 'CONVERSATION_UNAVAILABLE', 'Conversation is unavailable');

      const sequence = (
        BigInt(conversation.lastMessageSequence) + 1n
      ).toString();
      const message = await manager.getRepository(Message).save({
        conversationId: conversation.id,
        senderId: actorId,
        clientMessageId: randomUUID(),
        sequence,
        type: 'text',
        body: input.body,
        content: null,
      });
      await manager
        .getRepository(Conversation)
        .update(conversation.id, { lastMessageSequence: sequence });

      return {
        request: savedRequest
          ? this.view(savedRequest, actorId, conversation.id)
          : null,
        conversation: direct.conversation,
        message: this.messageView(message),
        syncKind,
      };
    });

    if (outcome.message) {
      this.events.publish({
        name: 'message:created',
        conversationId: outcome.message.conversationId,
        messageId: outcome.message.id,
        payload: outcome.message,
      });
    }
    this.events.friendshipChanged?.(
      actorId,
      input.recipientId,
      outcome.syncKind,
    );
    return {
      request: outcome.request,
      conversation: outcome.conversation,
      message: outcome.message,
    };
  }

  async list(actorId: string, input: MessageRequestsQueryDto) {
    const query = this.db
      .getRepository(MessageRequest)
      .createQueryBuilder('request')
      .innerJoinAndSelect(
        'request.requester',
        'requester',
        "requester.status = 'active'",
      )
      .innerJoinAndSelect(
        'request.recipient',
        'recipient',
        "recipient.status = 'active'",
      )
      .where(
        input.direction === 'incoming'
          ? 'request.recipientId = :actorId'
          : input.direction === 'outgoing'
            ? 'request.requesterId = :actorId'
            : '(request.recipientId = :actorId OR request.requesterId = :actorId)',
        { actorId },
      )
      .andWhere("request.status = 'pending'")
      .orderBy('request.updatedAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .take(input.limit + 1);
    if (input.cursor) {
      const cursorRow = await this.db
        .getRepository(MessageRequest)
        .findOneBy({ id: input.cursor });
      if (!cursorRow) fail(400, 'INVALID_CURSOR', 'Cursor is invalid');
      query.andWhere(
        '(request.updatedAt < :cursorUpdatedAt OR (request.updatedAt = :cursorUpdatedAt AND request.id < :cursor))',
        { cursorUpdatedAt: cursorRow.updatedAt, cursor: cursorRow.id },
      );
    }
    const rows = await query.getMany();

    const peerIds = rows.map((row) =>
      row.requesterId.toLowerCase() === actorId.toLowerCase()
        ? row.recipientId
        : row.requesterId,
    );
    const convRows = peerIds.length
      ? await this.db.query<{ id: string; peerId: string }[]>(
          `SELECT id,
                  CASE WHEN direct_user_low_id = @0 THEN direct_user_high_id ELSE direct_user_low_id END AS "peerId"
           FROM conversations
           WHERE type = 'direct'
             AND deleted_at IS NULL
             AND ((direct_user_low_id = @0 AND direct_user_high_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@1)))
               OR (direct_user_high_id = @0 AND direct_user_low_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@1))))`,
          [actorId, JSON.stringify(peerIds)],
        )
      : [];
    const convMap = new Map(
      convRows.map((c) => [c.peerId.toLowerCase(), c.id]),
    );

    return pageResult(
      rows.map((row) => {
        const peerId = (
          row.requesterId.toLowerCase() === actorId.toLowerCase()
            ? row.recipientId
            : row.requesterId
        ).toLowerCase();
        return this.view(row, actorId, convMap.get(peerId) ?? null);
      }),
      input.limit,
    );
  }

  async respond(
    actorId: string,
    id: string,
    action: 'accept' | 'reject' | 'cancel',
  ) {
    const outcome = await this.db.transaction(async (manager) => {
      const repository = manager.getRepository(MessageRequest);
      const found = await repository.findOneBy({ id });
      if (
        !found ||
        ![
          found.requesterId.toLowerCase(),
          found.recipientId.toLowerCase(),
        ].includes(actorId.toLowerCase())
      )
        fail(404, 'MESSAGE_REQUEST_NOT_FOUND', 'Request not found');
      const [low, high] = [
        found.requesterId.toLowerCase(),
        found.recipientId.toLowerCase(),
      ].sort();
      await manager.query(
        "EXEC sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Transaction'",
        [`conversation:direct:${low}:${high}`],
      );
      await manager.query(
        "EXEC sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Transaction'",
        [`message-request:${low}:${high}`],
      );
      const users = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .where('user.id IN (:...ids)', { ids: [low, high] })
        .orderBy('user.id', 'ASC')
        .setLock('pessimistic_read')
        .getMany();
      if (users.length !== 2 || users.some((user) => user.status !== 'active'))
        fail(404, 'USER_UNAVAILABLE', 'User is unavailable');
      const row = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) fail(404, 'MESSAGE_REQUEST_NOT_FOUND', 'Request not found');
      row.requester = users.find((user) => user.id === row.requesterId)!;
      row.recipient = users.find((user) => user.id === row.recipientId)!;
      if (row.status !== 'pending')
        fail(409, 'MESSAGE_REQUEST_STATE_CONFLICT', 'Request was handled');
      const peerId =
        row.requesterId === actorId ? row.recipientId : row.requesterId;

      if (action === 'cancel') {
        if (row.requesterId !== actorId)
          fail(403, 'MESSAGE_REQUEST_FORBIDDEN', 'Only sender may cancel');
        row.status = 'cancelled';
        row.respondedAt = new Date();
        await repository.save(row);
        return {
          request: this.view(row, actorId),
          peerId,
          syncKind: 'request_updated' as const,
          cleared: undefined as
            | { conversationId: string; clearedAfterSequence: string }
            | undefined,
          conversation: undefined,
        };
      }
      if (row.recipientId !== actorId)
        fail(403, 'MESSAGE_REQUEST_FORBIDDEN', 'Only recipient may respond');
      row.status = action === 'accept' ? 'accepted' : 'rejected';
      row.respondedAt = new Date();
      await repository.save(row);

      if (action === 'reject') {
        let cleared:
          { conversationId: string; clearedAfterSequence: string } | undefined;
        const conv = await manager.getRepository(Conversation).findOne({
          where: { directUserLowId: low, directUserHighId: high },
          lock: { mode: 'pessimistic_write' },
        });
        if (conv) {
          const clearedAfterSequence = conv.lastMessageSequence ?? '0';
          await manager
            .getRepository(ConversationMember)
            .update(
              { conversationId: conv.id, userId: actorId },
              { clearedAfterSequence },
            );
          cleared = { conversationId: conv.id, clearedAfterSequence };
        }
        return {
          request: this.view(row, actorId, conv?.id ?? null),
          peerId,
          syncKind: 'request_updated' as const,
          cleared,
          conversation: undefined,
        };
      }

      const result = await this.conversations.ensureDirect(
        manager,
        row.requesterId,
        row.recipientId,
      );
      return {
        request: this.view(row, actorId, result.conversation.id),
        peerId,
        syncKind: 'accepted' as const,
        cleared: undefined,
        conversation: result.conversation,
      };
    });

    if (outcome.cleared) {
      this.events.publish({
        name: 'conversation:history-cleared',
        conversationId: outcome.cleared.conversationId,
        targetUserIds: [actorId],
        payload: outcome.cleared,
      });
    }
    this.events.friendshipChanged?.(actorId, outcome.peerId, outcome.syncKind);
    return {
      request: outcome.request,
      ...(outcome.conversation ? { conversation: outcome.conversation } : {}),
    };
  }
}
