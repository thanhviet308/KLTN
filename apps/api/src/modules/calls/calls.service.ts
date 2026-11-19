import { HttpException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { writeNotification } from '../notifications/notification-writer';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { pageResult } from '../../common/page.dto';
import type { PageDto } from '../../common/page.dto';
import { Call } from '../database/entities/call.entity';
import { CallParticipant } from '../database/entities/call-participant.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { ConversationMemberPeriod } from '../database/entities/conversation-member-period.entity';
import { Conversation } from '../database/entities/conversation.entity';
import { Friendship } from '../database/entities/friendship.entity';
import { MessageRequest } from '../database/entities/message-request.entity';
import { Message } from '../database/entities/message.entity';
import type { AcceptCallDto, CreateCallDto } from './calls.dto';
import { RealtimeEvents } from '../realtime/realtime-events.module';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';
import { AccessToken } from 'livekit-server-sdk';

const RING_TTL_MS = 45_000;

function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

function monotonicCallTime(
  call: Call,
  participant?: CallParticipant,
  reference = new Date(),
) {
  return new Date(
    Math.max(
      reference.getTime(),
      call.createdAt.getTime(),
      call.startedAt?.getTime() ?? 0,
      participant?.invitedAt.getTime() ?? 0,
      participant?.joinedAt?.getTime() ?? 0,
    ),
  );
}

@Injectable()
export class CallsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(RealtimeEvents) private readonly events: RealtimeEvents,
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  private publish(
    name: 'call:incoming' | 'call:updated',
    actorId: string,
    result: { call: ReturnType<CallsService['view']> },
    message?: ReturnType<CallsService['messageView']>,
  ) {
    this.events.publish({
      name,
      actorId,
      conversationId: result.call.conversationId,
      targetUserIds: result.call.participants
        .map((participant) => participant.userId)
        .filter((userId) => userId !== actorId),
      payload: result,
    });
    if (message) this.publishMessage(message);
    return result;
  }

  private messageView(message: Message) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      clientMessageId: message.clientMessageId,
      sequence: message.sequence,
      type: message.type,
      body: message.body,
      content: message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
    };
  }

  private publishMessage(message: ReturnType<CallsService['messageView']>) {
    this.events.publish({
      name: 'message:created',
      conversationId: message.conversationId,
      messageId: message.id,
      payload: message,
    });
  }

  private async createHistoryMessage(manager: EntityManager, call: Call) {
    if (!['ended', 'rejected', 'missed', 'cancelled'].includes(call.status))
      return undefined;
    const callStatus = call.status as
      'ended' | 'rejected' | 'missed' | 'cancelled';
    const messages = manager.getRepository(Message);
    const existing = await messages.findOneBy({
      senderId: call.initiatorId,
      clientMessageId: call.id,
    });
    if (existing) return undefined;
    const rows: { last_message_sequence: string }[] = await manager.query(
      `WITH updated AS (
         UPDATE conversations
         SET last_message_sequence = last_message_sequence + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING last_message_sequence
       )
       SELECT last_message_sequence FROM updated`,
      [call.conversationId],
    );
    const sequence = rows[0]?.last_message_sequence;
    if (!sequence)
      fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');
    const durationSeconds = call.startedAt
      ? Math.max(
          0,
          Math.floor(
            ((call.endedAt ?? new Date()).getTime() -
              call.startedAt.getTime()) /
              1000,
          ),
        )
      : 0;
    const message = await messages.save({
      conversationId: call.conversationId,
      senderId: call.initiatorId,
      clientMessageId: call.id,
      sequence,
      type: 'call',
      body: null,
      content: {
        callId: call.id,
        callType: call.type,
        callStatus,
        durationSeconds,
      },
    });
    return this.messageView(message);
  }

  private view(call: Call, participants: CallParticipant[]) {
    const summaryEnabled = call.summaryEnabled ?? false;
    return {
      id: call.id,
      conversationId: call.conversationId,
      initiatorId: call.initiatorId,
      type: call.type,
      status: call.status,
      summaryEnabled,
      summaryRecorderId:
        call.summaryRecorderId ?? (summaryEnabled ? call.initiatorId : null),
      ringExpiresAt: call.ringExpiresAt,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      participants: participants.map((participant) => ({
        userId: participant.userId,
        status: participant.status,
        invitedAt: participant.invitedAt,
        joinedAt: participant.joinedAt,
        leftAt: participant.leftAt,
      })),
    };
  }

  private async participants(manager: EntityManager, callId: string) {
    return manager.getRepository(CallParticipant).find({
      where: { callId },
      order: { userId: 'ASC' },
    });
  }

  private async expire(manager: EntityManager, call: Call, now = new Date()) {
    if (call.status !== 'ringing' || call.ringExpiresAt > now) return undefined;
    call.status = 'missed';
    call.endedAt = monotonicCallTime(call, undefined, now);
    await manager.getRepository(Call).save(call);
    await manager
      .getRepository(CallParticipant)
      .createQueryBuilder()
      .update()
      .set({
        status: () =>
          "CASE WHEN status = 'invited' THEN 'missed' ELSE 'cancelled' END",
      })
      .where('call_id = :callId', { callId: call.id })
      .andWhere("status IN ('invited', 'accepted')")
      .execute();
    for (const participant of await this.participants(manager, call.id)) {
      if (
        participant.status !== 'missed' ||
        participant.userId === call.initiatorId
      )
        continue;
      await writeNotification(
        manager,
        participant.userId,
        'call',
        {
          title:
            call.type === 'video'
              ? 'Bạn có cuộc gọi video nhỡ'
              : 'Bạn có cuộc gọi thoại nhỡ',
          conversationId: call.conversationId,
          callId: call.id,
          callerId: call.initiatorId,
          actorId: call.initiatorId,
        },
        `missed_call:${call.id}`,
      );
    }
    return this.createHistoryMessage(manager, call);
  }

  private async lockedCall(
    manager: EntityManager,
    id: string,
    actorId: string,
  ) {
    const call = await manager.getRepository(Call).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!call) fail(404, 'CALL_NOT_FOUND', 'Call was not found');
    const participant = await manager.getRepository(CallParticipant).findOne({
      where: { callId: id, userId: actorId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!participant) fail(404, 'CALL_NOT_FOUND', 'Call was not found');
    const message = await this.expire(manager, call);
    return { call, participant, message };
  }

  private async result(manager: EntityManager, call: Call) {
    return { call: this.view(call, await this.participants(manager, call.id)) };
  }

  async create(actorId: string, conversationId: string, input: CreateCallDto) {
    const result = await this.db.transaction(async (manager) => {
      const requestId = input.clientRequestId.toLowerCase();
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`call:create:${actorId}:${requestId}`],
      );
      const calls = manager.getRepository(Call);
      const duplicate = await calls.findOne({
        where: { initiatorId: actorId, clientRequestId: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (duplicate) {
        if (
          duplicate.conversationId !== conversationId ||
          duplicate.type !== input.type
        )
          fail(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Request ID was already used for a different payload',
          );
        const message = await this.expire(manager, duplicate);
        return {
          result: await this.result(manager, duplicate),
          created: false,
          message,
        };
      }

      // The partial unique index is the final guard. This lock also serializes
      // two different request IDs while no open call row exists yet.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`call:conversation:${conversationId}`],
      );

      const membership = await manager
        .getRepository(ConversationMemberPeriod)
        .findOne({
          where: { conversationId, userId: actorId, leftAt: IsNull() },
          lock: { mode: 'pessimistic_read' },
        });
      if (!membership)
        fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');

      const conversation = await manager.getRepository(Conversation).findOne({
        where: { id: conversationId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_read' },
      });
      if (!conversation)
        fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');
      if (conversation.type === 'direct') {
        const friendship = await manager.getRepository(Friendship).findOneBy({
          pairLowId: conversation.directUserLowId!,
          pairHighId: conversation.directUserHighId!,
          status: 'accepted',
        });
        const acceptedRequest = friendship
          ? null
          : await manager.getRepository(MessageRequest).findOneBy({
              pairLowId: conversation.directUserLowId!,
              pairHighId: conversation.directUserHighId!,
              status: 'accepted',
            });
        if (!friendship && !acceptedRequest)
          fail(
            403,
            'MESSAGING_PERMISSION_REQUIRED',
            'Friendship or an accepted message request is required to start a call',
          );
      }

      const open = await calls
        .createQueryBuilder('call')
        .where('call.conversationId = :conversationId', { conversationId })
        .andWhere("call.status IN ('ringing', 'active')")
        .setLock('pessimistic_write')
        .getOne();
      if (open) {
        await this.expire(manager, open);
        if (open.status === 'ringing' || open.status === 'active')
          fail(
            409,
            'CALL_ALREADY_OPEN',
            'Conversation already has an open call',
          );
      }

      const members = await manager
        .getRepository(ConversationMember)
        .createQueryBuilder('member')
        .innerJoin('member.user', 'user', "user.status = 'active'")
        .innerJoin(
          ConversationMemberPeriod,
          'period',
          'period.conversationId = member.conversationId AND period.userId = member.userId AND period.leftAt IS NULL',
        )
        .where('member.conversationId = :conversationId', { conversationId })
        .orderBy('member.userId', 'ASC')
        .setLock('pessimistic_read')
        .getMany();
      if (members.length < 2)
        fail(409, 'CALL_NO_RECIPIENTS', 'Call requires another active member');

      const now = new Date();
      const summaryEnabled = input.summaryEnabled === true;
      const call = await calls.save({
        clientRequestId: requestId,
        conversationId,
        initiatorId: actorId,
        roomName: `call_${randomUUID()}`,
        type: input.type,
        summaryEnabled,
        summaryRecorderId: summaryEnabled ? actorId : null,
        status: 'ringing',
        ringExpiresAt: new Date(now.getTime() + RING_TTL_MS),
        startedAt: null,
        endedAt: null,
      });
      await manager.getRepository(CallParticipant).insert(
        members.map((member) => ({
          callId: call.id,
          conversationId,
          userId: member.userId,
          status: member.userId === actorId ? 'accepted' : 'invited',
        })),
      );
      return {
        result: await this.result(manager, call),
        created: true,
        message: undefined,
      };
    });
    if (result.created)
      return this.publish('call:incoming', actorId, result.result);
    if (result.message)
      return this.publish(
        'call:updated',
        actorId,
        result.result,
        result.message,
      );
    return result.result;
  }

  async get(actorId: string, id: string) {
    const value = await this.db.transaction(async (manager) => {
      const { call, message } = await this.lockedCall(manager, id, actorId);
      return { result: await this.result(manager, call), message };
    });
    if (value.message) this.publishMessage(value.message);
    return value.result;
  }

  async token(actorId: string, id: string) {
    const livekitUrl = this.config.get('LIVEKIT_URL', { infer: true });
    const apiKey = this.config.get('LIVEKIT_API_KEY', { infer: true });
    const apiSecret = this.config.get('LIVEKIT_API_SECRET', { infer: true });
    if (!livekitUrl || !apiKey || !apiSecret)
      fail(
        503,
        'LIVEKIT_NOT_CONFIGURED',
        'LiveKit is not configured on this server',
      );

    const authorization = await this.db.transaction(async (manager) => {
      const { call, participant } = await this.lockedCall(manager, id, actorId);
      if (!['ringing', 'active'].includes(call.status))
        fail(409, 'CALL_STATE_CONFLICT', 'Call is no longer active');
      if (!['accepted', 'joined'].includes(participant.status))
        fail(409, 'CALL_NOT_ACCEPTED', 'Accept the call before joining media');
      return { roomName: call.roomName, type: call.type };
    });

    const ttlSeconds = 10 * 60;
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: actorId,
      ttl: ttlSeconds,
    });
    accessToken.addGrant({
      room: authorization.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    return {
      url: livekitUrl,
      token: await accessToken.toJwt(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      callType: authorization.type,
    };
  }

  async list(actorId: string, input: PageDto) {
    const value = await this.db.transaction(async (manager) => {
      const query = manager
        .getRepository(Call)
        .createQueryBuilder('call')
        .innerJoin(
          CallParticipant,
          'mine',
          'mine.callId = call.id AND mine.userId = :actorId',
          {
            actorId,
          },
        )
        .andWhere(
          "EXISTS (SELECT 1 FROM users u WHERE u.id=call.initiator_id AND u.status='active')",
        )
        .orderBy('call.createdAt', 'DESC')
        .addOrderBy('call.id', 'DESC')
        .setLock('pessimistic_write')
        .take(input.limit + 1);
      if (input.cursor) {
        const cursor = await manager.getRepository(CallParticipant).findOneBy({
          callId: input.cursor.toLowerCase(),
          userId: actorId,
        });
        if (!cursor) fail(400, 'CURSOR_INVALID', 'Cursor is invalid');
        query.andWhere(
          '(call.createdAt, call.id) < ((SELECT created_at FROM calls WHERE id = :cursor), :cursor)',
          { cursor: input.cursor.toLowerCase() },
        );
      }
      const rows = await query.getMany();
      const messages = [];
      for (const call of rows) {
        const message = await this.expire(manager, call);
        if (message) messages.push(message);
      }
      const participantRows = rows.length
        ? await manager
            .getRepository(CallParticipant)
            .createQueryBuilder('participant')
            .where('participant.callId IN (:...ids)', {
              ids: rows.map((call) => call.id),
            })
            .orderBy('participant.userId', 'ASC')
            .getMany()
        : [];
      const byCall = new Map<string, CallParticipant[]>();
      for (const participant of participantRows) {
        const values = byCall.get(participant.callId) ?? [];
        values.push(participant);
        byCall.set(participant.callId, values);
      }
      return {
        page: pageResult(
          rows.map((call) => this.view(call, byCall.get(call.id) ?? [])),
          input.limit,
        ),
        messages,
      };
    });
    for (const message of value.messages) this.publishMessage(message);
    return value.page;
  }

  async accept(actorId: string, id: string, input?: AcceptCallDto) {
    const result = await this.db.transaction(async (manager) => {
      const { call, participant } = await this.lockedCall(manager, id, actorId);
      if (participant.status === 'joined') return this.result(manager, call);
      const canAccept =
        (call.status === 'ringing' &&
          ['invited', 'accepted'].includes(participant.status)) ||
        (call.status === 'active' &&
          ['invited', 'accepted', 'left', 'rejected'].includes(
            participant.status,
          ));
      if (!canAccept)
        fail(409, 'CALL_STATE_CONFLICT', 'Call can no longer be accepted');
      const now = monotonicCallTime(call, participant);
      if (call.status === 'ringing') {
        call.status = 'active';
        call.startedAt = now;
        if (
          input?.summaryEnabled === true &&
          !call.summaryEnabled &&
          !call.summaryRecorderId
        ) {
          call.summaryEnabled = true;
          call.summaryRecorderId = actorId;
        }
        await manager.getRepository(Call).save(call);
      }
      await manager.getRepository(CallParticipant).update(
        { callId: id, userId: actorId },
        {
          status: 'joined',
          joinedAt: () => 'GREATEST(CURRENT_TIMESTAMP, invited_at)',
          leftAt: null,
        },
      );
      if (actorId !== call.initiatorId)
        await manager.getRepository(CallParticipant).update(
          { callId: id, userId: call.initiatorId, status: 'accepted' },
          {
            status: 'joined',
            joinedAt: () => 'GREATEST(CURRENT_TIMESTAMP, invited_at)',
          },
        );
      return this.result(manager, call);
    });
    return this.publish('call:updated', actorId, result);
  }

  async reject(actorId: string, id: string) {
    const result = await this.db.transaction(async (manager) => {
      const {
        call,
        participant,
        message: expiredMessage,
      } = await this.lockedCall(manager, id, actorId);
      if (
        participant.status === 'rejected' ||
        participant.status === 'cancelled'
      )
        return {
          result: await this.result(manager, call),
          message: expiredMessage,
        };
      if (
        !['ringing', 'active'].includes(call.status) ||
        !['invited', 'accepted'].includes(participant.status)
      )
        fail(409, 'CALL_STATE_CONFLICT', 'Call can no longer be rejected');
      const participants = manager.getRepository(CallParticipant);
      if (actorId === call.initiatorId) {
        const now = monotonicCallTime(call);
        call.status = 'cancelled';
        call.endedAt = now;
        await manager.getRepository(Call).save(call);
        await participants
          .createQueryBuilder()
          .update()
          .set({ status: 'cancelled' })
          .where('call_id = :id', { id })
          .andWhere("status IN ('invited', 'accepted')")
          .execute();
      } else {
        participant.status = 'rejected';
        await participants.save(participant);
        const remaining = await participants.count({
          where: { callId: id, status: 'invited' },
        });
        if (remaining === 0 && call.status === 'ringing') {
          const now = monotonicCallTime(call);
          call.status = 'rejected';
          call.endedAt = now;
          await manager.getRepository(Call).save(call);
          await participants.update(
            { callId: id, userId: call.initiatorId, status: 'accepted' },
            { status: 'cancelled' },
          );
        }
      }
      return {
        result: await this.result(manager, call),
        message:
          expiredMessage ?? (await this.createHistoryMessage(manager, call)),
      };
    });
    return this.publish('call:updated', actorId, result.result, result.message);
  }

  async leave(actorId: string, id: string) {
    const result = await this.db.transaction(async (manager) => {
      const {
        call,
        participant,
        message: expiredMessage,
      } = await this.lockedCall(manager, id, actorId);
      if (participant.status === 'left')
        return {
          result: await this.result(manager, call),
          message: expiredMessage,
        };
      if (call.status !== 'active' || participant.status !== 'joined')
        fail(
          409,
          'CALL_STATE_CONFLICT',
          'Participant is not in an active call',
        );
      const now = monotonicCallTime(call, participant);
      participant.status = 'left';
      participant.leftAt = now;
      await manager.getRepository(CallParticipant).save(participant);
      const conversation = await manager.getRepository(Conversation).findOne({
        where: { id: call.conversationId },
        select: { id: true, type: true },
      });
      if (!conversation)
        fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');
      if (conversation.type === 'direct') {
        const message = await this.finish(manager, call, now);
        return {
          result: await this.result(manager, call),
          message: expiredMessage ?? message,
        };
      }
      const joined = await manager.getRepository(CallParticipant).count({
        where: { callId: id, status: 'joined' },
      });
      if (
        joined > 0 &&
        call.summaryEnabled &&
        (call.summaryRecorderId ?? call.initiatorId) === actorId
      ) {
        call.summaryEnabled = false;
        call.summaryRecorderId = null;
        await manager.getRepository(Call).save(call);
      }
      const message =
        joined === 0 ? await this.finish(manager, call, now) : undefined;
      return {
        result: await this.result(manager, call),
        message: expiredMessage ?? message,
      };
    });
    return this.publish('call:updated', actorId, result.result, result.message);
  }

  async end(actorId: string, id: string) {
    const result = await this.db.transaction(async (manager) => {
      const { call, message: expiredMessage } = await this.lockedCall(
        manager,
        id,
        actorId,
      );
      if (['ended', 'cancelled'].includes(call.status))
        return {
          result: await this.result(manager, call),
          message: expiredMessage,
        };
      if (actorId !== call.initiatorId)
        fail(403, 'CALL_FORBIDDEN', 'Only the initiator can end the call');
      if (call.status === 'ringing') {
        call.status = 'cancelled';
        call.endedAt = monotonicCallTime(call);
        await manager.getRepository(Call).save(call);
        await manager
          .getRepository(CallParticipant)
          .createQueryBuilder()
          .update()
          .set({ status: 'cancelled' })
          .where('call_id = :id', { id })
          .andWhere("status IN ('invited', 'accepted')")
          .execute();
      } else if (call.status === 'active') {
        const message = await this.finish(
          manager,
          call,
          monotonicCallTime(call),
        );
        return {
          result: await this.result(manager, call),
          message: expiredMessage ?? message,
        };
      } else fail(409, 'CALL_STATE_CONFLICT', 'Call can no longer be ended');
      return {
        result: await this.result(manager, call),
        message:
          expiredMessage ?? (await this.createHistoryMessage(manager, call)),
      };
    });
    return this.publish('call:updated', actorId, result.result, result.message);
  }

  private async finish(manager: EntityManager, call: Call, now: Date) {
    call.status = 'ended';
    call.endedAt = now;
    await manager.getRepository(Call).save(call);
    await manager
      .getRepository(CallParticipant)
      .createQueryBuilder()
      .update()
      .set({
        status: () =>
          "CASE WHEN status = 'joined' THEN 'left' ELSE 'cancelled' END",
        leftAt: () =>
          "CASE WHEN status = 'joined' THEN GREATEST(CURRENT_TIMESTAMP, joined_at) ELSE left_at END",
      })
      .where('call_id = :id', { id: call.id })
      .andWhere("status IN ('joined', 'invited', 'accepted')")
      .execute();
    return this.createHistoryMessage(manager, call);
  }
}
