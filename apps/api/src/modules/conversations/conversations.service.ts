import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { createHash } from 'node:crypto';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { ConversationMemberPeriod } from '../database/entities/conversation-member-period.entity';
import { Friendship } from '../database/entities/friendship.entity';
import { User } from '../database/entities/user.entity';
import { pageResult } from '../../common/page.dto';
import type { PageDto } from '../../common/page.dto';
import { publicUserView } from '../users/user-view';
import type { CreateConversationDto } from './conversations.dto';

function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}
const GROUP_LIMIT = 50;

@Injectable()
export class ConversationsService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}

  private view(conversation: Conversation, member: ConversationMember) {
    return {
      id: conversation.id,
      type: conversation.type,
      title: conversation.title,
      creatorId: conversation.creatorId,
      directUserLowId: conversation.directUserLowId,
      directUserHighId: conversation.directUserHighId,
      lastMessageSequence: conversation.lastMessageSequence,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      membership: {
        role: member.role,
        lastReadSequence: member.lastReadSequence,
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

  private async join(
    manager: EntityManager,
    conversation: Conversation,
    userId: string,
    role: ConversationMember['role'],
  ) {
    const members = manager.getRepository(ConversationMember);
    await members
      .createQueryBuilder()
      .insert()
      .values({ conversationId: conversation.id, userId, role })
      .orIgnore()
      .execute();
    const member = await members.findOneByOrFail({
      conversationId: conversation.id,
      userId,
    });
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
  private async access(
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
        const [low, high] = [actorId, recipientId].sort();
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`conversation:direct:${low}:${high}`],
        );
        const repository = manager.getRepository(Conversation);
        const existing = await repository.findOne({
          where: { directUserLowId: low, directUserHighId: high },
          lock: { mode: 'pessimistic_write' },
        });
        if (existing) {
          const { conversation, member } = await this.access(
            manager,
            existing.id,
            actorId,
            true,
          );
          return { conversation: this.view(conversation, member) };
        }
        await this.activeUsers(manager, [actorId, recipientId]);
        await this.requireFriends(manager, actorId, [recipientId]);
        const conversation = await repository.save({
          type: 'direct',
          creatorId: actorId,
          directUserLowId: low,
          directUserHighId: high,
          title: null,
        });
        const member = await this.join(
          manager,
          conversation,
          actorId,
          'member',
        );
        await this.join(manager, conversation, recipientId, 'member');
        return { conversation: this.view(conversation, member) };
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
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
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
        const { conversation, member } = await this.access(
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
      .orderBy('member.conversationId', 'ASC')
      .take(input.limit + 1);
    if (input.cursor)
      query.andWhere('member.conversationId > :cursor', {
        cursor: input.cursor,
      });
    return pageResult(
      (await query.getMany()).map((member) =>
        this.view(member.conversation, member),
      ),
      input.limit,
    );
  }

  async get(actorId: string, id: string) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.access(manager, id, actorId);
      return { conversation: this.view(conversation, member) };
    });
  }

  async rename(actorId: string, id: string, title: string) {
    return this.db.transaction(async (manager) => {
      const { conversation, member } = await this.access(
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

  async members(actorId: string, id: string, input: PageDto) {
    return this.db.transaction(async (manager) => {
      await this.access(manager, id, actorId);
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
      const { conversation, member } = await this.access(
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
      const { conversation, member } = await this.access(
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
        leftAt: new Date(),
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
      const { conversation, member } = await this.access(
        manager,
        id,
        actorId,
        true,
      );
      this.requireGroup(conversation);
      if (member.role !== 'owner')
        fail(403, 'CONVERSATION_FORBIDDEN', 'Only the owner can change roles');
      const { member: target } = await this.access(manager, id, userId, true);
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
      const { conversation, member } = await this.access(
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
      const { member: target } = await this.access(manager, id, userId, true);
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
}
