import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { ConversationsService } from '../conversations/conversations.service';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { Message } from '../database/entities/message.entity';
import { MessageReceipt } from '../database/entities/message-receipt.entity';
import { Friendship } from '../database/entities/friendship.entity';
import { User } from '../database/entities/user.entity';
import type { MessageHistoryDto, SendMessageDto } from './messages.dto';
import type { PageDto } from '../../common/page.dto';
import { pageResult } from '../../common/page.dto';
import { RealtimeEvents } from '../realtime/realtime-events.module';
import { MessageRateLimit } from './message-rate-limit';

const MAX_SEQUENCE = 9223372036854775807n;
function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
    @Inject(RealtimeEvents) private readonly events: RealtimeEvents,
    @Inject(MessageRateLimit) private readonly rateLimit: MessageRateLimit,
  ) {}

  private view(message: Message) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      clientMessageId: message.clientMessageId,
      sequence: message.sequence,
      type: message.type,
      body: message.body,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
    };
  }

  private visible(query: SelectQueryBuilder<Message>, actorId: string) {
    return query.andWhere('message.deletedAt IS NULL').andWhere(
      `EXISTS (
      SELECT 1 FROM conversation_member_periods period
      WHERE period.conversation_id = message.conversation_id AND period.user_id = :actorId
        AND message.sequence > period.joined_after_sequence
        AND (period.left_after_sequence IS NULL OR message.sequence <= period.left_after_sequence)
    )`,
      { actorId },
    );
  }

  private async findVisible(
    manager: EntityManager,
    actorId: string,
    conversationId: string,
    id: string,
  ) {
    const row = await this.visible(
      manager
        .getRepository(Message)
        .createQueryBuilder('message')
        .where(
          'message.conversationId = :conversationId AND message.id = :id',
          { conversationId, id },
        ),
      actorId,
    ).getOne();
    if (!row) fail(404, 'MESSAGE_NOT_FOUND', 'Message not found');
    return row;
  }

  async send(actorId: string, conversationId: string, input: SendMessageDto) {
    this.rateLimit.take(actorId, 'send');
    const result = await this.db.transaction(async (manager) => {
      // Key scope is sender across conversations, matching messages_client_id.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`message:${actorId}:${input.clientMessageId}`],
      );
      const { conversation } = await this.conversations.requireAccess(
        manager,
        conversationId,
        actorId,
        true,
      );
      const messages = manager.getRepository(Message);
      const existing = await messages.findOneBy({
        senderId: actorId,
        clientMessageId: input.clientMessageId,
      });
      if (existing) {
        if (
          existing.conversationId !== conversationId ||
          existing.type !== input.type ||
          existing.body !== input.body
        )
          fail(
            409,
            'MESSAGE_IDEMPOTENCY_CONFLICT',
            'Message key was already used for a different payload',
          );
        const visible = await this.findVisible(
          manager,
          actorId,
          conversationId,
          existing.id,
        );
        return { message: this.view(visible), created: false };
      }
      const users = manager.getRepository(User).createQueryBuilder('user');
      const ids =
        conversation.type === 'direct'
          ? [conversation.directUserLowId!, conversation.directUserHighId!]
          : [actorId];
      const active = await users
        .where('user.id IN (:...ids)', { ids })
        .orderBy('user.id', 'ASC')
        .setLock('pessimistic_read')
        .getMany();
      if (
        active.length !== ids.length ||
        active.some((user) => user.status !== 'active')
      )
        fail(
          403,
          'MESSAGE_SEND_FORBIDDEN',
          'Account is unavailable for messaging',
        );
      if (conversation.type === 'direct') {
        const friendship = await manager.getRepository(Friendship).findOne({
          where: {
            pairLowId: conversation.directUserLowId!,
            pairHighId: conversation.directUserHighId!,
            status: 'accepted',
          },
          lock: { mode: 'pessimistic_read' },
        });
        if (!friendship)
          fail(
            403,
            'FRIENDSHIP_REQUIRED',
            'Users must be friends to send new direct messages',
          );
      }
      const sequence = BigInt(conversation.lastMessageSequence) + 1n;
      if (sequence > MAX_SEQUENCE)
        fail(
          409,
          'MESSAGE_SEQUENCE_EXHAUSTED',
          'Conversation sequence limit reached',
        );
      const message = await messages.save({
        conversationId,
        senderId: actorId,
        clientMessageId: input.clientMessageId,
        type: 'text',
        body: input.body,
        sequence: sequence.toString(),
      });
      await manager
        .getRepository(Conversation)
        .update(conversationId, { lastMessageSequence: sequence.toString() });
      return { message: this.view(message), created: true };
    });
    if (result.created)
      this.events.publish({
        name: 'message:created',
        conversationId,
        messageId: result.message.id,
        payload: result.message,
      });
    return { message: result.message };
  }

  // Hold the same conversation lock used by membership mutations until emit/join.
  // A room is a routing hint, never proof of current membership or visibility.
  async authorizedEvent(
    actorId: string,
    conversationId: string,
    messageId: string | undefined,
    action: () => void | Promise<void>,
    typingActorId?: string,
  ) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      if (typingActorId)
        await this.conversations.requireAccess(
          manager,
          conversationId,
          typingActorId,
        );
      if (messageId)
        await this.findVisible(manager, actorId, conversationId, messageId);
      await action();
    });
  }

  async history(
    actorId: string,
    conversationId: string,
    input: MessageHistoryDto,
  ) {
    if (input.cursor !== undefined && BigInt(input.cursor) > MAX_SEQUENCE)
      fail(
        400,
        'INVALID_MESSAGE_CURSOR',
        'Cursor exceeds PostgreSQL bigint range',
      );
    return this.db.transaction(async (manager) => {
      const { conversation } = await this.conversations.requireAccess(
        manager,
        conversationId,
        actorId,
      );
      const query = this.visible(
        manager
          .getRepository(Message)
          .createQueryBuilder('message')
          .where('message.conversationId = :conversationId', {
            conversationId,
          }),
        actorId,
      );
      const forward = input.direction === 'forward';
      if (input.cursor !== undefined)
        query.andWhere(
          forward ? 'message.sequence > :cursor' : 'message.sequence < :cursor',
          { cursor: input.cursor },
        );
      query
        .orderBy('message.sequence', forward ? 'ASC' : 'DESC')
        .take(input.limit + 1);
      const rows = await query.getMany();
      const items = rows
        .slice(0, input.limit)
        .map((message) => this.view(message));
      return {
        items,
        nextCursor: rows.length > input.limit ? items.at(-1)!.sequence : null,
        highWatermark: conversation.lastMessageSequence,
        direction: input.direction,
      };
    });
  }

  async receipt(
    actorId: string,
    conversationId: string,
    messageId: string,
    read: boolean,
  ) {
    this.rateLimit.take(actorId, 'receipt');
    const result = await this.db.transaction(async (manager) => {
      const { member } = await this.conversations.requireAccess(
        manager,
        conversationId,
        actorId,
        true,
      );
      const message = await this.findVisible(
        manager,
        actorId,
        conversationId,
        messageId,
      );
      if (message.senderId === actorId)
        fail(
          400,
          'SELF_MESSAGE_RECEIPT',
          'Receipts are acknowledgements from recipients',
        );
      const receipts = manager.getRepository(MessageReceipt);
      let receipt = await receipts.findOneBy({
        messageId: message.id,
        userId: actorId,
      });
      if (!receipt)
        receipt = await receipts.save({
          messageId: message.id,
          userId: actorId,
          conversationId,
        });
      if (read && !receipt.readAt) {
        receipt.readAt = new Date(
          Math.max(Date.now(), receipt.deliveredAt.getTime()),
        );
        receipt = await receipts.save(receipt);
      }
      if (
        read &&
        (member.lastReadSequence === null ||
          BigInt(member.lastReadSequence) < BigInt(message.sequence))
      ) {
        member.lastReadSequence = message.sequence;
        await manager
          .getRepository(ConversationMember)
          .update(
            { conversationId, userId: actorId },
            { lastReadSequence: member.lastReadSequence },
          );
      }
      return {
        receipt: {
          messageId: receipt.messageId,
          userId: actorId,
          deliveredAt: receipt.deliveredAt,
          readAt: receipt.readAt,
        },
        lastReadSequence: member.lastReadSequence,
      };
    });
    this.events.publish({
      name: 'message:receipt',
      conversationId,
      messageId,
      payload: { conversationId, ...result },
    });
    return result;
  }

  async receipts(
    actorId: string,
    conversationId: string,
    messageId: string,
    input: PageDto,
  ) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      await this.findVisible(manager, actorId, conversationId, messageId);
      const query = manager
        .getRepository(MessageReceipt)
        .createQueryBuilder('receipt')
        .where(
          'receipt.messageId = :messageId AND receipt.conversationId = :conversationId',
          { messageId, conversationId },
        )
        .orderBy('receipt.userId', 'ASC')
        .take(input.limit + 1);
      if (input.cursor)
        query.andWhere('receipt.userId > :cursor', { cursor: input.cursor });
      return pageResult(
        (await query.getMany()).map((receipt) => ({
          id: receipt.userId,
          messageId: receipt.messageId,
          userId: receipt.userId,
          deliveredAt: receipt.deliveredAt,
          readAt: receipt.readAt,
        })),
        input.limit,
      );
    });
  }
}
