import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Notification } from '../database/entities/notification.entity';
import { User } from '../database/entities/user.entity';
import { publicUserView } from '../users/user-view';
import { pageResult } from '../../common/page.dto';
import type { PageDto } from '../../common/page.dto';

const ACTOR_PAYLOAD_KEYS = [
  'actorId',
  'requesterId',
  'userId',
  'callerId',
  'senderId',
] as const;

function extractActorId(
  payload?: Record<string, unknown> | null,
): string | undefined {
  if (!payload) return undefined;
  for (const key of ACTOR_PAYLOAD_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}

  async list(userId: string, input: PageDto) {
    const repository = this.db.getRepository(Notification);
    const query = repository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .orderBy('notification.createdAt', 'DESC')
      .addOrderBy('notification.id', 'DESC')
      .take(input.limit + 1);
    if (input.cursor) {
      const cursor = await repository.findOneBy({ id: input.cursor, userId });
      if (!cursor) throw new HttpException({ code: 'INVALID_CURSOR' }, 400);
      query.andWhere(
        '(notification.createdAt, notification.id) < ((SELECT created_at FROM notifications WHERE id = :id AND user_id = :userId), :id)',
        {
          userId,
          id: cursor.id,
        },
      );
    }
    const [rows, unreadCount] = await Promise.all([
      query.getMany(),
      repository.countBy({ userId, readAt: IsNull() }),
    ]);
    const page = pageResult(rows, input.limit);
    const actorIds = [
      ...new Set(
        page.items
          .map((row) => extractActorId(row.payload))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let actorById = new Map<string, ReturnType<typeof publicUserView>>();
    if (actorIds.length > 0) {
      const users = await this.db
        .getRepository(User)
        .createQueryBuilder('user')
        .where('user.id IN (:...ids)', { ids: actorIds })
        .getMany();
      actorById = new Map(users.map((user) => [user.id, publicUserView(user)]));
    }
    const items = page.items.map((row) => {
      const actorId = extractActorId(row.payload);
      const actor = actorId ? actorById.get(actorId) : undefined;
      return actor ? { ...row, actor } : row;
    });
    return { ...page, items, unreadCount };
  }

  async read(userId: string, id?: string) {
    const repository = this.db.getRepository(Notification);
    if (id && !(await repository.existsBy({ id, userId })))
      throw new HttpException({ code: 'NOTIFICATION_NOT_FOUND' }, 404);
    await repository
      .createQueryBuilder()
      .update()
      .set({ readAt: () => 'GREATEST(CURRENT_TIMESTAMP, created_at)' })
      .where({ userId, readAt: IsNull(), ...(id ? { id } : {}) })
      .execute();
    return { success: true };
  }
}
