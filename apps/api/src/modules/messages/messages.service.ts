import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { ConversationsService } from '../conversations/conversations.service';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { Attachment } from '../database/entities/attachment.entity';
import { Message } from '../database/entities/message.entity';
import { MessageReceipt } from '../database/entities/message-receipt.entity';
import { Friendship } from '../database/entities/friendship.entity';
import { User } from '../database/entities/user.entity';
import type {
  EditMessageDto,
  MessageHistoryDto,
  SendMessageDto,
} from './messages.dto';
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
  private async reactionSummary(
    manager: EntityManager,
    actorId: string,
    messageId: string,
  ) {
    const items: { emoji: string; count: number; reacted: boolean }[] =
      await manager.query(
        `SELECT emoji, count(*)::int AS count, bool_or(user_id = $2) AS reacted
       FROM message_reactions WHERE message_id = $1 GROUP BY emoji ORDER BY emoji`,
        [messageId, actorId],
      );
    return { messageId, items };
  }

  async reactions(actorId: string, conversationId: string, messageId: string) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      await this.findVisible(manager, actorId, conversationId, messageId);
      return this.reactionSummary(manager, actorId, messageId);
    });
  }

  async react(
    actorId: string,
    conversationId: string,
    messageId: string,
    emoji: string | null,
  ) {
    this.rateLimit.take(actorId, 'send');
    const result = await this.db.transaction(async (manager) => {
      // Same lock as edits/deletions: a reaction cannot race a retraction.
      await this.conversations.requireAccess(
        manager,
        conversationId,
        actorId,
        true,
      );
      await this.findVisible(manager, actorId, conversationId, messageId);
      if (emoji === null) {
        await manager.query(
          'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
          [messageId, actorId],
        );
      } else {
        await manager.query(
          `INSERT INTO message_reactions (conversation_id, message_id, user_id, emoji)
          VALUES ($1, $2, $3, $4) ON CONFLICT (message_id, user_id)
          DO UPDATE SET emoji = EXCLUDED.emoji, updated_at = now()`,
          [conversationId, messageId, actorId, emoji],
        );
      }
      return this.reactionSummary(manager, actorId, messageId);
    });
    // Notify clients to re-fetch their own summary; never broadcast actor-specific reacted flags.
    this.events.publish({
      name: 'message:reactions',
      conversationId,
      messageId,
      payload: { conversationId, messageId },
    });
    return result;
  }
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
      body: message.deletedAt ? null : (message.editedBody ?? message.body),
      content: message.deletedAt ? null : message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
    };
  }

  private visible(
    query: SelectQueryBuilder<Message>,
    actorId: string,
    includeDeleted = false,
  ) {
    if (!includeDeleted) query.andWhere('message.deletedAt IS NULL');
    return query.andWhere(
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
    includeDeleted = false,
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
      includeDeleted,
    ).getOne();
    if (!row) fail(404, 'MESSAGE_NOT_FOUND', 'Message not found');
    return row;
  }

  async send(
    actorId: string,
    conversationId: string,
    input: SendMessageDto,
    media?: {
      id: string;
      objectKey: string;
      fileName: string;
      mimeType: string;
      size: number;
      sha256: string;
      type: 'image' | 'file' | 'voice';
    },
  ) {
    if (
      !media &&
      input.type === 'location' &&
      (!input.location || input.body !== undefined)
    )
      fail(
        400,
        'INVALID_LOCATION',
        'Location requires coordinates and no text body',
      );
    if (!media && input.type === 'text' && input.location !== undefined)
      fail(400, 'INVALID_PAYLOAD', 'Text cannot contain coordinates');
    const type = media?.type ?? input.type;
    const body = type === 'text' ? input.body! : null;
    const content = media
      ? {
          attachmentId: media.id,
          fileName: media.fileName,
          mimeType: media.mimeType,
          size: media.size,
          sha256: media.sha256,
        }
      : input.type === 'location'
        ? {
            latitude: input.location!.latitude,
            longitude: input.location!.longitude,
          }
        : null;
    this.rateLimit.take(actorId, 'send');
    const result = await this.db.transaction(async (manager) => {
      // Key scope is sender across conversations, matching messages_client_id.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`message:${actorId}:${input.clientMessageId}`],
      );
      if (media)
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`media-quota:${actorId}`],
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
          existing.type !== type ||
          existing.body !== body ||
          (media
            ? existing.content?.sha256 !== media.sha256 ||
              existing.content?.fileName !== media.fileName ||
              existing.content?.mimeType !== media.mimeType
            : existing.content?.latitude !== content?.latitude ||
              existing.content?.longitude !== content?.longitude)
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
          true,
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
      if (media) {
        const totals: { bytes: string }[] = await manager.query(
          "SELECT COALESCE(sum(size), 0)::text AS bytes FROM attachments WHERE uploader_id = $1 AND status = 'attached'",
          [actorId],
        );
        if (
          BigInt(totals[0]!.bytes) + BigInt(media.size) >
          512n * 1024n * 1024n
        )
          fail(
            413,
            'STORAGE_QUOTA_EXCEEDED',
            'Attachment storage limit reached',
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
        type,
        body,
        content,
        sequence: sequence.toString(),
      });
      if (media)
        await manager.getRepository(Attachment).insert({
          id: media.id,
          conversationId,
          uploaderId: actorId,
          messageId: message.id,
          clientRequestId: input.clientMessageId,
          objectKey: media.objectKey,
          fileName: media.fileName,
          mimeType: media.mimeType,
          size: String(media.size),
          status: 'attached',
          uploadExpiresAt: new Date(Date.now() + 3600000),
          completedAt: new Date(),
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

  async attachment(actorId: string, conversationId: string, messageId: string) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      const message = await this.findVisible(
        manager,
        actorId,
        conversationId,
        messageId,
      );
      const attachment = await manager
        .getRepository(Attachment)
        .createQueryBuilder('attachment')
        .addSelect('attachment.objectKey')
        .where(
          'attachment.messageId = :messageId AND attachment.status = :status',
          { messageId: message.id, status: 'attached' },
        )
        .getOne();
      if (!attachment)
        fail(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');
      return attachment;
    });
  }

  async authorizeUpload(actorId: string, conversationId: string) {
    this.rateLimit.take(actorId, 'upload');
    await this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
    });
  }

  // Hold the same conversation lock used by membership mutations until emit/join.
  // A room is a routing hint, never proof of current membership or visibility.
  async authorizedEvent(
    actorId: string,
    conversationId: string,
    messageId: string | undefined,
    action: () => void | Promise<void>,
    typingActorId?: string,
    includeDeleted = false,
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
        await this.findVisible(
          manager,
          actorId,
          conversationId,
          messageId,
          includeDeleted,
        );
      await action();
    });
  }

  async get(actorId: string, conversationId: string, messageId: string) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      return {
        message: this.view(
          await this.findVisible(
            manager,
            actorId,
            conversationId,
            messageId,
            true,
          ),
        ),
      };
    });
  }

  async edit(
    actorId: string,
    conversationId: string,
    messageId: string,
    input: EditMessageDto,
  ) {
    this.rateLimit.take(actorId, 'send');
    const result = await this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(
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
        true,
      );
      if (message.senderId !== actorId)
        fail(
          403,
          'MESSAGE_EDIT_FORBIDDEN',
          'Only the sender may edit a message',
        );
      if (message.deletedAt)
        fail(409, 'MESSAGE_DELETED', 'Deleted messages cannot be edited');
      if (message.type !== 'text')
        fail(
          409,
          'MESSAGE_EDIT_UNSUPPORTED',
          'Only text messages can be edited',
        );
      // A retry with the already-current body is a no-op, including after lost ACK.
      if ((message.editedBody ?? message.body) === input.body)
        return { message: this.view(message), changed: false };
      if ((message.editedAt?.toISOString() ?? null) !== input.expectedEditedAt)
        fail(
          409,
          'MESSAGE_EDIT_CONFLICT',
          'Message changed; fetch its current state before editing',
        );
      message.editedBody = input.body;
      message.editedAt = new Date(
        Math.max(
          Date.now(),
          (message.editedAt ?? message.createdAt).getTime() + 1,
        ),
      );
      await manager.getRepository(Message).save(message);
      return { message: this.view(message), changed: true };
    });
    if (result.changed)
      this.events.publish({
        name: 'message:updated',
        conversationId,
        messageId,
        payload: result.message,
      });
    return { message: result.message };
  }

  async remove(actorId: string, conversationId: string, messageId: string) {
    this.rateLimit.take(actorId, 'send');
    const result = await this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(
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
        true,
      );
      if (message.senderId !== actorId)
        fail(
          403,
          'MESSAGE_DELETE_FORBIDDEN',
          'Only the sender may delete a message',
        );
      if (message.deletedAt)
        return { message: this.view(message), changed: false };
      message.deletedAt = new Date(
        Math.max(
          Date.now(),
          (message.editedAt ?? message.createdAt).getTime() + 1,
        ),
      );
      await manager.getRepository(Message).save(message);
      return { message: this.view(message), changed: true };
    });
    if (result.changed)
      this.events.publish({
        name: 'message:deleted',
        conversationId,
        messageId,
        payload: result.message,
      });
    return { message: result.message };
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
        true,
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
