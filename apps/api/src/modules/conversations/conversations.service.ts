import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { ConversationMemberPeriod } from '../database/entities/conversation-member-period.entity';
import { Friendship } from '../database/entities/friendship.entity';
import { MessageRequest } from '../database/entities/message-request.entity';
import { Message } from '../database/entities/message.entity';
import { User } from '../database/entities/user.entity';
import {
  decryptMessageContent,
  decryptMessageText,
} from '../database/message-encryption';
import { pageResult } from '../../common/page.dto';
import type { PageDto } from '../../common/page.dto';
import { publicUserView } from '../users/user-view';
import { RealtimeEvents } from '../realtime/realtime-events.module';
import type { CreateConversationDto } from './conversations.dto';

function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}
const GROUP_LIMIT = 50;

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Optional()
    @Inject(RealtimeEvents)
    private readonly events?: RealtimeEvents,
  ) {}

  private view(conversation: Conversation, member: ConversationMember) {
    return {
      id: conversation.id,
      type: conversation.type,
      title: conversation.title,
      background: conversation.background ?? 'default',
      nicknames: conversation.nicknames ?? {},
      creatorId: conversation.creatorId,
      directUserLowId: conversation.directUserLowId,
      directUserHighId: conversation.directUserHighId,
      lastMessageSequence: conversation.lastMessageSequence,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      membership: {
        role: member.role,
        lastReadSequence: member.lastReadSequence,
        clearedAfterSequence: member.clearedAfterSequence ?? '0',
      },
    };
  }

  private async activeUsers(manager: EntityManager, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    const rows = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .where('user.id IN (:...ids)', { ids: unique })
      .orderBy('user.id', 'ASC')
      .setLock('pessimistic_read')
      .getMany();
    if (
      rows.length !== unique.length ||
      rows.some((user) => user.status !== 'active')
    )
      fail(404, 'USER_UNAVAILABLE', 'User is unavailable');
  }

  private async requireFriends(
    manager: EntityManager,
    actorId: string,
    ids: string[],
  ) {
    if (!ids.length) return;
    const rows = await manager
      .getRepository(Friendship)
      .createQueryBuilder('friendship')
      .where("friendship.status = 'accepted'")
      .andWhere(
        '((friendship.requesterId = :actorId AND friendship.recipientId IN (:...ids)) OR (friendship.recipientId = :actorId AND friendship.requesterId IN (:...ids)))',
        { actorId, ids },
      )
      .orderBy('friendship.id', 'ASC')
      .setLock('pessimistic_read')
      .getMany();
    if (rows.length !== ids.length)
      fail(
        403,
        'FRIENDSHIP_REQUIRED',
        'Only friends can be invited to a new conversation',
      );
  }

  private async resolveDirectMessageRequest(
    manager: EntityManager,
    actorId: string,
    conversation: Conversation,
  ): Promise<{
    id: string | null;
    direction: 'incoming' | 'outgoing';
    status: 'pending';
  } | null> {
    if (
      conversation.type !== 'direct' ||
      !conversation.directUserLowId ||
      !conversation.directUserHighId
    ) {
      return null;
    }
    const low = conversation.directUserLowId;
    const high = conversation.directUserHighId;
    const friendship = await manager.getRepository(Friendship).findOneBy({
      pairLowId: low,
      pairHighId: high,
      status: 'accepted',
    });
    if (friendship) return null;
    const request = await manager.getRepository(MessageRequest).findOneBy({
      pairLowId: low,
      pairHighId: high,
    });
    if (request?.status === 'accepted') return null;
    if (request?.status === 'pending') {
      return {
        id: request.id,
        direction: request.recipientId === actorId ? 'incoming' : 'outgoing',
        status: 'pending',
      };
    }
    return {
      id: null,
      direction: 'outgoing',
      status: 'pending',
    };
  }

  private async materializeLegacyRequestsForUser(actorId: string) {
    const legacyRows: { requesterId: string; recipientId: string }[] =
      await this.db.query(
        `SELECT TOP (20) mr.requester_id AS "requesterId", mr.recipient_id AS "recipientId"
         FROM message_requests mr
         JOIN users req_user ON req_user.id = mr.requester_id AND req_user.status = 'active'
         JOIN users rec_user ON rec_user.id = mr.recipient_id AND rec_user.status = 'active'
         LEFT JOIN conversations c
           ON c.direct_user_low_id = mr.pair_low_id
          AND c.direct_user_high_id = mr.pair_high_id
          AND c.deleted_at IS NULL
         WHERE (mr.requester_id = @0 OR mr.recipient_id = @0)
           AND mr.status IN ('pending', 'accepted')
           AND (c.id IS NULL OR c.last_message_sequence = 0)`,
        [actorId],
      );
    for (const row of legacyRows) {
      await this.db
        .transaction((manager) =>
          this.ensureDirect(manager, row.requesterId, row.recipientId),
        )
        .catch(() => undefined);
    }
  }

  private async join(
    manager: EntityManager,
    conversation: Conversation,
    userId: string,
    role: ConversationMember['role'],
  ) {
    const members = manager.getRepository(ConversationMember);
    let member = await members.findOneBy({
      conversationId: conversation.id,
      userId,
    });
    if (!member) {
      await members.insert({ conversationId: conversation.id, userId, role });
      member = await members.findOneByOrFail({
        conversationId: conversation.id,
        userId,
      });
    }
    const periods = manager.getRepository(ConversationMemberPeriod);
    const current = await periods.findOneBy({
      conversationId: conversation.id,
      userId,
      leftAt: IsNull(),
    });
    if (!current) {
      await members.update(
        { conversationId: conversation.id, userId },
        { role },
      );
      member.role = role;
      await periods.save({
        conversationId: conversation.id,
        userId,
        joinedAfterSequence: conversation.lastMessageSequence,
      });
    }
    return member;
  }

  // Mutation paths lock the conversation first; future message writes must use
  // the same lock to serialize sequence boundaries with membership changes.
  async requireAccess(
    manager: EntityManager,
    id: string,
    actorId: string,
    write = false,
  ) {
    const conversation = await manager.getRepository(Conversation).findOne({
      where: { id, deletedAt: IsNull() },
      lock: { mode: write ? 'pessimistic_write' : 'pessimistic_read' },
    });
    if (!conversation)
      fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    const period = await manager
      .getRepository(ConversationMemberPeriod)
      .findOneBy({ conversationId: id, userId: actorId, leftAt: IsNull() });
    const member = await manager
      .getRepository(ConversationMember)
      .findOneBy({ conversationId: id, userId: actorId });
    if (!period || !member)
      fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    const unavailable = await manager
      .getRepository(User)
      .createQueryBuilder('access_user')
      .where('access_user.id IN (:...ids)', {
        ids:
          conversation.type === 'direct'
            ? [
                actorId,
                conversation.directUserLowId,
                conversation.directUserHighId,
              ]
            : [actorId],
      })
      .andWhere("access_user.status <> 'active'")
      .getCount();
    if (unavailable)
      fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation unavailable');
    return { conversation, member };
  }

  private requireGroup(conversation: Conversation) {
    if (conversation.type !== 'group')
      fail(
        409,
        'DIRECT_CONVERSATION_IMMUTABLE',
        'Direct conversation membership and title cannot be changed',
      );
  }
  private requireManager(member: ConversationMember) {
    if (member.role !== 'owner' && member.role !== 'admin')
      fail(403, 'CONVERSATION_FORBIDDEN', 'Group manager permissions required');
  }

  // Caller owns the transaction; acceptance and conversation creation commit together.
  async ensureDirect(
    manager: EntityManager,
    actorId: string,
    recipientId: string,
    materializeLegacy = true,
  ) {
    const [low, high] = [
      actorId.toLowerCase(),
      recipientId.toLowerCase(),
    ].sort();
    await manager.query(
      "EXEC sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Transaction'",
      [`conversation:direct:${low}:${high}`],
    );
    await this.activeUsers(manager, [actorId, recipientId]);
    const repository = manager.getRepository(Conversation);
    let conversation = await repository.findOne({
      where: { directUserLowId: low, directUserHighId: high },
      lock: { mode: 'pessimistic_write' },
    });
    let member: ConversationMember;
    if (conversation) {
      const access = await this.requireAccess(
        manager,
        conversation.id,
        actorId,
        true,
      );
      conversation = access.conversation;
      member = access.member;
    } else {
      conversation = await repository.save({
        type: 'direct',
        creatorId: actorId,
        directUserLowId: low,
        directUserHighId: high,
        title: null,
      });
      member = await this.join(manager, conversation, actorId, 'member');
      await this.join(manager, conversation, recipientId, 'member');
    }
    if (
      materializeLegacy &&
      BigInt(conversation.lastMessageSequence ?? '0') === 0n
    ) {
      const legacyReq = await manager.getRepository(MessageRequest).findOneBy({
        pairLowId: low,
        pairHighId: high,
      });
      if (
        legacyReq &&
        (legacyReq.status === 'pending' || legacyReq.status === 'accepted') &&
        legacyReq.body?.trim()
      ) {
        const sequence = '1';
        await manager.getRepository(Message).save({
          conversationId: conversation.id,
          senderId: legacyReq.requesterId,
          clientMessageId: randomUUID(),
          sequence,
          type: 'text',
          body: legacyReq.body,
          content: null,
        });
        await repository.update(conversation.id, {
          lastMessageSequence: sequence,
        });
        conversation.lastMessageSequence = sequence;
      }
    }
    const messageRequest = await this.resolveDirectMessageRequest(
      manager,
      actorId,
      conversation,
    );
    return {
      conversation: {
        ...this.view(conversation, member),
        messageRequest,
      },
    };
  }

  async create(actorId: string, input: CreateConversationDto) {
    if (input.type === 'direct') {
      if (
        input.title !== undefined ||
        input.memberIds !== undefined ||
        input.clientRequestId !== undefined
      )
        fail(
          400,
          'CONVERSATION_INPUT_INVALID',
          'Direct conversations require only recipientId',
        );
      const recipientId = input.recipientId!;
      if (recipientId === actorId)
        fail(
          400,
          'SELF_CONVERSATION',
          'Cannot create a direct conversation with yourself',
        );
      return this.db.transaction(async (manager) => {
        return this.ensureDirect(manager, actorId, recipientId);
      });
    }
    if (input.recipientId !== undefined || input.memberIds!.includes(actorId))
      fail(
        400,
        'CONVERSATION_INPUT_INVALID',
        'Group memberIds must exclude the creator',
      );
    const memberIds = [...input.memberIds!].sort();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ title: input.title, memberIds }))
      .digest('hex');
    return this.db.transaction(async (manager) => {
      await manager.query(
        "EXEC sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Transaction'",
        [
          `conversation:group:${actorId}:${input.clientRequestId!.toLowerCase()}`,
        ],
      );
      const repository = manager.getRepository(Conversation);
      const existing = await repository
        .createQueryBuilder('conversation')
        .addSelect('conversation.creationFingerprint')
        .where(
          'conversation.creatorId = :actorId AND conversation.clientRequestId = :requestId',
          { actorId, requestId: input.clientRequestId },
        )
        .setLock('pessimistic_write')
        .getOne();
      if (existing) {
        if (existing.creationFingerprint !== fingerprint)
          fail(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Request ID was already used for a different payload',
          );
        const { conversation, member } = await this.requireAccess(
          manager,
          existing.id,
          actorId,
          true,
        );
        return { conversation: this.view(conversation, member) };
      }
      await this.activeUsers(manager, [actorId, ...memberIds]);
      await this.requireFriends(manager, actorId, memberIds);
      const conversation = await repository.save({
        type: 'group',
        title: input.title!,
        creatorId: actorId,
        clientRequestId: input.clientRequestId!,
        creationFingerprint: fingerprint,
      });
      const member = await this.join(manager, conversation, actorId, 'owner');
      for (const id of memberIds)
        await this.join(manager, conversation, id, 'member');
      return { conversation: this.view(conversation, member) };
    });
  }

  async list(actorId: string, input: PageDto) {
    await this.materializeLegacyRequestsForUser(actorId);
    const query = this.db
      .getRepository(ConversationMember)
      .createQueryBuilder('member')
      .innerJoinAndSelect(
        'member.conversation',
        'conversation',
        'conversation.deletedAt IS NULL',
      )
      .innerJoin(
        ConversationMemberPeriod,
        'period',
        'period.conversationId = member.conversationId AND period.userId = member.userId AND period.leftAt IS NULL',
      )
      .where('member.userId = :actorId', { actorId })
      .andWhere(
        "(conversation.type <> 'direct' OR NOT EXISTS (SELECT 1 FROM users hidden_peer WHERE hidden_peer.id IN (conversation.direct_user_low_id,conversation.direct_user_high_id) AND hidden_peer.status <> 'active'))",
      )
      .andWhere(
        `(conversation.type <> 'direct'
          OR EXISTS (
            SELECT 1 FROM friendships f
            WHERE f.pair_low_id = conversation.direct_user_low_id
              AND f.pair_high_id = conversation.direct_user_high_id
              AND f.status = 'accepted'
          )
          OR EXISTS (
            SELECT 1 FROM message_requests mr
            WHERE mr.pair_low_id = conversation.direct_user_low_id
              AND mr.pair_high_id = conversation.direct_user_high_id
              AND mr.status = 'accepted'
          )
          OR (
            conversation.last_message_sequence > member.cleared_after_sequence
            AND NOT EXISTS (
              SELECT 1 FROM message_requests mr_closed
              WHERE mr_closed.pair_low_id = conversation.direct_user_low_id
                AND mr_closed.pair_high_id = conversation.direct_user_high_id
                AND mr_closed.recipient_id = :actorId
                AND mr_closed.status IN ('rejected', 'cancelled')
            )
          ))`,
        { actorId },
      )
      .orderBy('conversation.updatedAt', 'DESC')
      .addOrderBy('member.conversationId', 'DESC')
      .take(input.limit + 1);
    if (input.cursor) {
      const cursorResult = await this.get(actorId, input.cursor);
      query.andWhere(
        '(conversation.updatedAt < :cursorUpdatedAt OR (conversation.updatedAt = :cursorUpdatedAt AND member.conversationId < :cursor))',
        {
          cursorUpdatedAt: cursorResult.conversation.updatedAt,
          cursor: input.cursor,
        },
      );
    }
    const members = await query.getMany();
    const convIdsJson = JSON.stringify(
      members.map((member) => member.conversationId),
    );
    const unreadRows: { conversationId: string; count: number }[] =
      members.length
        ? await this.db.query(
            `
        SELECT m.conversation_id AS "conversationId", CAST(COUNT(*) AS INT) AS count
        FROM messages m
        JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = @1
        WHERE m.conversation_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@0)) AND m.sender_id <> @1
          AND EXISTS (SELECT 1 FROM users u WHERE u.id=m.sender_id AND u.status='active') AND m.deleted_at IS NULL AND m.sequence > COALESCE(cm.last_read_sequence, 0)
          AND m.sequence > cm.cleared_after_sequence
          AND EXISTS (
            SELECT 1 FROM conversation_member_periods p
            WHERE p.conversation_id = m.conversation_id AND p.user_id = @1
              AND m.sequence > p.joined_after_sequence
              AND (p.left_after_sequence IS NULL OR m.sequence <= p.left_after_sequence)
          )
        GROUP BY m.conversation_id
      `,
            [convIdsJson, actorId],
          )
        : [];
    const unreadById = new Map(
      unreadRows.map((row) => [row.conversationId.toLowerCase(), row.count]),
    );
    const previews: {
      conversationId: string;
      id: string;
      senderId: string;
      senderName: string;
      sequence: string;
      type: string;
      body: string | null;
      content: Message['content'];
      createdAt: Date;
      deletedAt: Date | null;
    }[] = members.length
      ? await this.db.query(
          `
      SELECT latest.*, sender.display_name AS "senderName"
      FROM (SELECT CAST([value] AS UNIQUEIDENTIFIER) AS conversation_id FROM OPENJSON(@0)) AS requested
      CROSS APPLY (
        SELECT TOP (1) m.conversation_id AS "conversationId", m.id,
          m.sender_id AS "senderId", CAST(m.sequence AS NVARCHAR(30)) AS sequence, m.type, m.content,
          CASE WHEN m.deleted_at IS NULL THEN COALESCE(m.edited_body, m.body)
            ELSE NULL END AS body,
          m.created_at AS "createdAt", m.deleted_at AS "deletedAt"
        FROM messages m
        JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = @1
        WHERE m.conversation_id = requested.conversation_id AND EXISTS (SELECT 1 FROM users u WHERE u.id=m.sender_id AND u.status='active')
          AND m.sequence > cm.cleared_after_sequence
          AND EXISTS (
            SELECT 1 FROM conversation_member_periods p
            WHERE p.conversation_id = m.conversation_id AND p.user_id = @1
              AND m.sequence > p.joined_after_sequence
              AND (p.left_after_sequence IS NULL OR m.sequence <= p.left_after_sequence)
          )
        ORDER BY m.sequence DESC
      ) latest
      JOIN users sender ON sender.id = latest."senderId"
    `,
          [convIdsJson, actorId],
        )
      : [];
    const previewById = new Map(
      previews.map(({ conversationId, ...preview }) => {
        const body = decryptMessageText(preview.body);
        let rawContent = preview.content;
        if (typeof rawContent === 'string') {
          try {
            rawContent = JSON.parse(rawContent) as Message['content'];
          } catch {
            rawContent = null;
          }
        }
        const content = preview.deletedAt
          ? null
          : decryptMessageContent(rawContent);
        return [
          conversationId.toLowerCase(),
          { ...preview, content, body: body?.slice(0, 200) ?? null },
        ];
      }),
    );
    const peerIds = [
      ...new Set(
        members.flatMap(({ conversation }) =>
          conversation.type === 'direct'
            ? [
                conversation.directUserLowId?.toLowerCase() ===
                actorId.toLowerCase()
                  ? conversation.directUserHighId!
                  : conversation.directUserLowId!,
              ]
            : [],
        ),
      ),
    ];
    const peerIdsJson = JSON.stringify(peerIds);
    const [peers, friendRows, requestRows] = peerIds.length
      ? await Promise.all([
          this.db
            .getRepository(User)
            .createQueryBuilder('user')
            .select(['user.id', 'user.displayName', 'user.avatarKey'])
            .where('user.id IN (:...peerIds)', { peerIds })
            .getMany(),
          this.db.query<{ peerId: string }[]>(
            `SELECT CASE WHEN requester_id = @0 THEN recipient_id ELSE requester_id END AS "peerId"
             FROM friendships
             WHERE status = 'accepted'
               AND ((requester_id = @0 AND recipient_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@1)))
                 OR (recipient_id = @0 AND requester_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@1))))`,
            [actorId, peerIdsJson],
          ),
          this.db.query<
            {
              id: string;
              requesterId: string;
              recipientId: string;
              status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
            }[]
          >(
            `SELECT id, requester_id AS "requesterId", recipient_id AS "recipientId", status
             FROM message_requests
             WHERE (requester_id = @0 AND recipient_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@1)))
                OR (recipient_id = @0 AND requester_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@1)))`,
            [actorId, peerIdsJson],
          ),
        ])
      : [[], [], []];
    const peerById = new Map(
      peers.map((peer) => [peer.id.toLowerCase(), publicUserView(peer)]),
    );
    const friendSet = new Set(friendRows.map((r) => r.peerId.toLowerCase()));
    const requestByPeerId = new Map(
      requestRows.map((r) => [
        (r.requesterId.toLowerCase() === actorId.toLowerCase()
          ? r.recipientId
          : r.requesterId
        ).toLowerCase(),
        r,
      ]),
    );
    return pageResult(
      members.map((member) => {
        const peerId =
          member.conversation.type === 'direct'
            ? (member.conversation.directUserLowId?.toLowerCase() ===
              actorId.toLowerCase()
                ? member.conversation.directUserHighId!
                : member.conversation.directUserLowId!
              ).toLowerCase()
            : null;
        let messageRequest: {
          id: string | null;
          direction: 'incoming' | 'outgoing';
          status: 'pending';
        } | null = null;
        if (peerId && !friendSet.has(peerId)) {
          const req = requestByPeerId.get(peerId);
          if (req?.status === 'pending') {
            messageRequest = {
              id: req.id,
              direction:
                req.recipientId.toLowerCase() === actorId.toLowerCase()
                  ? 'incoming'
                  : 'outgoing',
              status: 'pending',
            };
          } else if (req?.status !== 'accepted') {
            messageRequest = {
              id: null,
              direction: 'outgoing',
              status: 'pending',
            };
          }
        }
        const convKey = member.conversationId.toLowerCase();
        return {
          ...this.view(member.conversation, member),
          lastMessage: previewById.get(convKey) ?? null,
          unreadCount: unreadById.get(convKey) ?? 0,
          peer: peerId ? (peerById.get(peerId) ?? null) : null,
          messageRequest,
        };
      }),
      input.limit,
    );
  }

  async get(actorId: string, id: string) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
      );
      const messageRequest =
        conversation.type === 'direct'
          ? await this.resolveDirectMessageRequest(
              manager,
              actorId,
              conversation,
            )
          : null;
      return {
        conversation: {
          ...this.view(conversation, member),
          messageRequest,
        },
      };
    });
  }

  async rename(actorId: string, id: string, title: string) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
        true,
      );
      this.requireGroup(conversation);
      this.requireManager(member);
      conversation.title = title;
      return {
        conversation: this.view(
          await manager.getRepository(Conversation).save(conversation),
          member,
        ),
      };
    });
  }

  async background(actorId: string, id: string, background: string) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
        true,
      );
      conversation.background = background;
      return {
        conversation: this.view(
          await manager.getRepository(Conversation).save(conversation),
          member,
        ),
      };
    });
  }

  async nickname(
    actorId: string,
    id: string,
    userId: string,
    nickname: string,
  ) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
        true,
      );
      await this.requireAccess(manager, id, userId, true);
      // The conversation lock serializes edits to different members' nicknames.
      const nicknames = { ...conversation.nicknames };
      if (nickname) nicknames[userId] = nickname;
      else delete nicknames[userId];
      conversation.nicknames = nicknames;
      return {
        conversation: this.view(
          await manager.getRepository(Conversation).save(conversation),
          member,
        ),
      };
    });
  }

  async members(actorId: string, id: string, input: PageDto) {
    return this.db.transaction(async (manager) => {
      await this.requireAccess(manager, id, actorId);
      const query = manager
        .getRepository(ConversationMember)
        .createQueryBuilder('member')
        .innerJoinAndSelect('member.user', 'user')
        .innerJoin(
          ConversationMemberPeriod,
          'period',
          'period.conversationId = member.conversationId AND period.userId = member.userId AND period.leftAt IS NULL',
        )
        .where('member.conversationId = :id', { id })
        .orderBy('member.userId', 'ASC')
        .take(input.limit + 1);
      if (input.cursor)
        query.andWhere('member.userId > :cursor', { cursor: input.cursor });
      return pageResult(
        (await query.getMany()).map((member) => ({
          id: member.userId,
          user: publicUserView(member.user),
          role: member.role,
        })),
        input.limit,
      );
    });
  }

  async addMember(actorId: string, id: string, userId: string) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
        true,
      );
      this.requireGroup(conversation);
      this.requireManager(member);
      const periods = manager.getRepository(ConversationMemberPeriod);
      const current = await periods.findOneBy({
        conversationId: id,
        userId,
        leftAt: IsNull(),
      });
      if (current)
        return {
          member: {
            userId,
            role: (
              await manager
                .getRepository(ConversationMember)
                .findOneByOrFail({ conversationId: id, userId })
            ).role,
          },
        };
      if (
        (await periods.countBy({ conversationId: id, leftAt: IsNull() })) >=
        GROUP_LIMIT
      )
        fail(409, 'GROUP_MEMBER_LIMIT', 'Group supports at most 50 members');
      await this.activeUsers(manager, [actorId, userId]);
      await this.requireFriends(manager, actorId, [userId]);
      const joined = await this.join(manager, conversation, userId, 'member');
      return { member: { userId, role: joined.role } };
    });
  }

  async removeMember(actorId: string, id: string, userId: string) {
    await this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
        true,
      );
      this.requireGroup(conversation);
      const target = await manager
        .getRepository(ConversationMember)
        .findOneBy({ conversationId: id, userId });
      if (actorId !== userId) {
        this.requireManager(member);
        if (
          target?.role === 'owner' ||
          (member.role === 'admin' && target?.role === 'admin')
        )
          fail(403, 'CONVERSATION_FORBIDDEN', 'Cannot remove this member');
      }
      const period = await manager
        .getRepository(ConversationMemberPeriod)
        .findOneBy({ conversationId: id, userId, leftAt: IsNull() });
      if (!period) return;
      if (target?.role === 'owner')
        fail(
          409,
          'OWNER_TRANSFER_REQUIRED',
          'Transfer ownership before leaving the group',
        );
      await manager.getRepository(ConversationMemberPeriod).update(period.id, {
        leftAt: () =>
          'CASE WHEN SYSDATETIMEOFFSET() > joined_at THEN SYSDATETIMEOFFSET() ELSE joined_at END',
        leftAfterSequence: conversation.lastMessageSequence,
      });
    });
  }

  async role(
    actorId: string,
    id: string,
    userId: string,
    role: 'admin' | 'member',
  ) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
        true,
      );
      this.requireGroup(conversation);
      if (member.role !== 'owner')
        fail(403, 'CONVERSATION_FORBIDDEN', 'Only the owner can change roles');
      const { member: target } = await this.requireAccess(
        manager,
        id,
        userId,
        true,
      );
      if (target.role === 'owner')
        fail(
          409,
          'OWNER_TRANSFER_REQUIRED',
          'Use ownership transfer to change the owner',
        );
      await this.activeUsers(manager, [actorId, userId]);
      await manager
        .getRepository(ConversationMember)
        .update({ conversationId: id, userId }, { role });
      return { member: { userId, role } };
    });
  }

  async transfer(actorId: string, id: string, userId: string) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
        true,
      );
      this.requireGroup(conversation);
      if (member.role !== 'owner')
        fail(
          403,
          'CONVERSATION_FORBIDDEN',
          'Only the owner can transfer ownership',
        );
      const { member: target } = await this.requireAccess(
        manager,
        id,
        userId,
        true,
      );
      await this.activeUsers(manager, [actorId, userId]);
      if (actorId !== userId) {
        const members = manager.getRepository(ConversationMember);
        await members.update(
          { conversationId: id, userId: actorId },
          { role: 'admin' },
        );
        await members.update(
          { conversationId: id, userId: target.userId },
          { role: 'owner' },
        );
      }
      return { ownerId: userId };
    });
  }

  async clearHistory(actorId: string, id: string) {
    const result = await this.db.transaction(async (manager) => {
      const { conversation, member } = await this.requireAccess(
        manager,
        id,
        actorId,
        true,
      );
      const latestSequence = BigInt(conversation.lastMessageSequence ?? '0');
      const currentCleared = BigInt(member.clearedAfterSequence ?? '0');
      const clearedAfterSequence = (
        latestSequence > currentCleared ? latestSequence : currentCleared
      ).toString();
      if (clearedAfterSequence !== (member.clearedAfterSequence ?? '0')) {
        await manager
          .getRepository(ConversationMember)
          .update(
            { conversationId: id, userId: actorId },
            { clearedAfterSequence },
          );
        member.clearedAfterSequence = clearedAfterSequence;
      }
      return {
        conversation: this.view(conversation, member),
        clearedAfterSequence,
      };
    });
    this.events?.publish({
      name: 'conversation:history-cleared',
      conversationId: id,
      targetUserIds: [actorId],
      payload: {
        conversationId: id,
        clearedAfterSequence: result.clearedAfterSequence,
      },
    });
    return result;
  }
}
