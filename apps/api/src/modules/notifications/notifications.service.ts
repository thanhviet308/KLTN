import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Notification } from '../database/entities/notification.entity';
import { pageResult } from '../../common/page.dto';
import type { PageDto } from '../../common/page.dto';

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
    return { ...pageResult(rows, input.limit), unreadCount };
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
