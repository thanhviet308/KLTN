import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { pageResult } from '../../common/page.dto';
import { ConversationsService } from '../conversations/conversations.service';
import { Conversation } from '../database/entities/conversation.entity';
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

  private view(row: MessageRequest, actorId: string) {
    const incoming = row.recipientId === actorId;
    return {
      id: row.id,
      direction: incoming ? 'incoming' : 'outgoing',
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
    return this.db.transaction(async (manager) => {
      const [low, high] = [actorId, input.recipientId].sort();
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
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
      if (friendship)
        fail(409, 'ALREADY_FRIENDS', 'Friends can message directly');
      const repository = manager.getRepository(MessageRequest);
      const existing = await repository.findOne({
        where: { pairLowId: low, pairHighId: high },
        relations: { requester: true, recipient: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing?.status === 'pending')
        fail(
          409,
          existing.requesterId === actorId
            ? 'MESSAGE_REQUEST_PENDING'
            : 'MESSAGE_REQUEST_RECEIVED',
          'A message request is already pending',
        );
      if (existing?.status === 'accepted')
        fail(409, 'MESSAGE_REQUEST_ACCEPTED', 'Messaging is already allowed');
      const row = existing ?? repository.create();
      row.requesterId = actorId;
      row.recipientId = input.recipientId;
      row.requester = users.find((user) => user.id === actorId)!;
      row.recipient = users.find((user) => user.id === input.recipientId)!;
      row.body = input.body;
      row.status = 'pending';
      row.respondedAt = null;
      const saved = await repository.save(row);
      return { request: this.view(saved, actorId) };
    });
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
      .orderBy('request.id', 'ASC')
      .take(input.limit + 1);
    if (input.cursor) query.andWhere('request.id > :cursor', input);
    const rows = await query.getMany();
    return pageResult(
      rows.map((row) => this.view(row, actorId)),
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
      if (!found || ![found.requesterId, found.recipientId].includes(actorId))
        fail(404, 'MESSAGE_REQUEST_NOT_FOUND', 'Request not found');
      const [low, high] = [found.requesterId, found.recipientId].sort();
      if (action === 'accept') {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`conversation:direct:${low}:${high}`],
        );
      }
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
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
        relations: { requester: true, recipient: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) fail(404, 'MESSAGE_REQUEST_NOT_FOUND', 'Request not found');
      if (row.status !== 'pending')
        fail(409, 'MESSAGE_REQUEST_STATE_CONFLICT', 'Request was handled');
      if (action === 'cancel') {
        if (row.requesterId !== actorId)
          fail(403, 'MESSAGE_REQUEST_FORBIDDEN', 'Only sender may cancel');
        row.status = 'cancelled';
        row.respondedAt = new Date();
        await repository.save(row);
        return { request: this.view(row, actorId) };
      }
      if (row.recipientId !== actorId)
        fail(403, 'MESSAGE_REQUEST_FORBIDDEN', 'Only recipient may respond');
      row.status = action === 'accept' ? 'accepted' : 'rejected';
      row.respondedAt = new Date();
      await repository.save(row);
      if (action === 'reject') return { request: this.view(row, actorId) };

      const result = await this.conversations.ensureDirect(
        manager,
        row.requesterId,
        row.recipientId,
      );
      const conversation = await manager.getRepository(Conversation).findOne({
        where: { id: result.conversation.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conversation)
        fail(409, 'CONVERSATION_UNAVAILABLE', 'Conversation is unavailable');
      const sequence = (
        BigInt(conversation.lastMessageSequence) + 1n
      ).toString();
      const message = await manager.getRepository(Message).save({
        conversationId: conversation.id,
        senderId: row.requesterId,
        clientMessageId: randomUUID(),
        sequence,
        type: 'text',
        body: row.body,
        content: null,
      });
      await manager
        .getRepository(Conversation)
        .update(conversation.id, { lastMessageSequence: sequence });
      return {
        request: this.view(row, actorId),
        conversation: result.conversation,
        message: this.messageView(message),
      };
    });
    if (outcome.message)
      this.events.publish({
        name: 'message:created',
        conversationId: outcome.message.conversationId,
        messageId: outcome.message.id,
        payload: outcome.message,
      });
    return {
      request: outcome.request,
      ...(outcome.conversation ? { conversation: outcome.conversation } : {}),
    };
  }
}
