import { ConversationsService } from '../conversations/conversations.service';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Friendship } from '../database/entities/friendship.entity';
import { User } from '../database/entities/user.entity';
import { publicUserView } from '../users/user-view';
import { pageResult } from '../../common/page.dto';
import type { PageDto } from '../../common/page.dto';
import type {
  FriendRequestsQueryDto,
  RespondFriendRequestDto,
} from './friendships.dto';

function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

@Injectable()
export class FriendshipsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
  ) {}

  private async lockUsers(manager: EntityManager, ids: string[]) {
    // Stable ordering avoids opposite-direction requests taking user locks differently.
    const users = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .where('user.id IN (:...ids)', { ids: [...new Set(ids)].sort() })
      .orderBy('user.id', 'ASC')
      .setLock('pessimistic_read')
      .getMany();
    if (
      users.length !== new Set(ids).size ||
      users.some((user) => user.status !== 'active')
    ) {
      fail(404, 'USER_UNAVAILABLE', 'User is unavailable');
    }
  }

  private view(row: Friendship) {
    return {
      id: row.id,
      requesterId: row.requesterId,
      recipientId: row.recipientId,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async request(actorId: string, recipientId: string) {
    recipientId = recipientId.toLowerCase();
    if (actorId === recipientId)
      fail(
        400,
        'SELF_FRIEND_REQUEST',
        'Cannot send a friend request to yourself',
      );
    return this.db.transaction(async (manager) => {
      const pairKey = [actorId, recipientId].sort().join(':');
      // Serialize request creation/reopening even if the pair has no row yet.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`friendship:${pairKey}`],
      );
      await this.lockUsers(manager, [actorId, recipientId]);
      const repository = manager.getRepository(Friendship);
      // Unique generated pair + ON CONFLICT serializes even when no row exists.
      await repository
        .createQueryBuilder()
        .insert()
        .values({ requesterId: actorId, recipientId, status: 'pending' })
        .orIgnore()
        .execute();
      const [low, high] = [actorId, recipientId].sort();
      const row = await repository.findOneOrFail({
        where: { pairLowId: low, pairHighId: high },
        lock: { mode: 'pessimistic_write' },
      });
      if (row.status === 'accepted')
        fail(409, 'ALREADY_FRIENDS', 'Users are already friends');
      if (row.status === 'pending') {
        if (row.requesterId !== actorId)
          fail(
            409,
            'INCOMING_REQUEST_EXISTS',
            'Respond to the existing incoming request',
          );
        return { request: this.view(row) };
      }
      // A new request gets a new ID; a delayed action cannot mutate a later invitation.
      await repository.delete(row.id);
      const fresh = await repository.save({
        requesterId: actorId,
        recipientId,
        status: 'pending',
      });
      return { request: this.view(fresh) };
    });
  }

  async respond(
    actorId: string,
    id: string,
    action: RespondFriendRequestDto['action'],
  ) {
    return this.db.transaction(async (manager) => {
      const repository = manager.getRepository(Friendship);
      const found = await repository.findOneBy({ id });
      if (!found || ![found.requesterId, found.recipientId].includes(actorId))
        fail(404, 'FRIEND_REQUEST_NOT_FOUND', 'Friend request not found');
      // Match direct creation's lock order before locking the friendship row.
      if (action === 'accept') {
        const [low, high] = [found.requesterId, found.recipientId].sort();
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`conversation:direct:${low}:${high}`],
        );
      }
      await this.lockUsers(manager, [found.requesterId, found.recipientId]);
      const row = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row)
        fail(404, 'FRIEND_REQUEST_NOT_FOUND', 'Friend request not found');
      const allowedActor =
        action === 'cancel' ? row.requesterId : row.recipientId;
      if (allowedActor !== actorId)
        fail(403, 'FRIEND_REQUEST_FORBIDDEN', 'Action is not permitted');
      const next =
        action === 'accept'
          ? 'accepted'
          : action === 'reject'
            ? 'rejected'
            : 'cancelled';
      if (row.status === next) {
        if (next === 'accepted')
          await this.conversations.ensureDirect(
            manager,
            row.requesterId,
            row.recipientId,
          );
        return { request: this.view(row) };
      }
      if (row.status !== 'pending')
        fail(
          409,
          'FRIEND_REQUEST_STATE_CONFLICT',
          'Friend request is no longer pending',
        );
      row.status = next;
      const saved = await repository.save(row);
      if (next === 'accepted')
        await this.conversations.ensureDirect(
          manager,
          row.requesterId,
          row.recipientId,
        );
      return { request: this.view(saved) };
    });
  }

  async requests(actorId: string, input: FriendRequestsQueryDto) {
    const incoming = input.direction === 'incoming';
    const query = this.db
      .getRepository(Friendship)
      .createQueryBuilder('friendship')
      .innerJoinAndSelect(
        incoming ? 'friendship.requester' : 'friendship.recipient',
        'peer',
        "peer.status = 'active'",
      )
      .where(
        incoming
          ? 'friendship.recipientId = :actorId'
          : 'friendship.requesterId = :actorId',
        { actorId },
      )
      .andWhere("friendship.status = 'pending'")
      .orderBy('friendship.id', 'ASC')
      .take(input.limit + 1);
    if (input.cursor)
      query.andWhere('friendship.id > :cursor', { cursor: input.cursor });
    const rows = await query.getMany();
    return pageResult(
      rows.map((row) => ({
        ...this.view(row),
        user: publicUserView(incoming ? row.requester : row.recipient),
      })),
      input.limit,
    );
  }

  async friends(actorId: string, input: PageDto) {
    const query = this.db
      .getRepository(Friendship)
      .createQueryBuilder('friendship')
      .innerJoinAndSelect(
        'friendship.requester',
        'requester',
        "requester.status = 'active'",
      )
      .innerJoinAndSelect(
        'friendship.recipient',
        'recipient',
        "recipient.status = 'active'",
      )
      .where(
        '(friendship.requesterId = :actorId OR friendship.recipientId = :actorId)',
        { actorId },
      )
      .andWhere("friendship.status = 'accepted'")
      .orderBy('friendship.id', 'ASC')
      .take(input.limit + 1);
    if (input.cursor)
      query.andWhere('friendship.id > :cursor', { cursor: input.cursor });
    return pageResult(
      (await query.getMany()).map((row) => ({
        id: row.id,
        user: publicUserView(
          row.requesterId === actorId ? row.recipient : row.requester,
        ),
        acceptedAt: row.updatedAt,
      })),
      input.limit,
    );
  }

  async remove(actorId: string, userId: string) {
    userId = userId.toLowerCase();
    if (actorId === userId)
      fail(400, 'SELF_FRIEND_REQUEST', 'Cannot remove yourself');
    await this.db.transaction(async (manager) => {
      const [low, high] = [actorId, userId].sort();
      const repository = manager.getRepository(Friendship);
      const row = await repository.findOne({
        where: { pairLowId: low, pairHighId: high },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || row.status === 'removed') return;
      if (row.status !== 'accepted')
        fail(409, 'FRIENDSHIP_STATE_CONFLICT', 'Users are not friends');
      row.status = 'removed';
      await repository.save(row);
    });
  }
}
