import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Session } from '../database/entities/session.entity';
import { AuditLog } from '../database/entities/audit-log.entity';
import { pageResult } from '../../common/page.dto';
import type { AdminUsersDto } from './workspace.dto';
import { RealtimeEvents } from '../realtime/realtime-events.module';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(RealtimeEvents) private readonly events: RealtimeEvents,
  ) {}
  private admin(user: User) {
    if (user.role !== 'admin')
      throw new HttpException({ code: 'ADMIN_REQUIRED' }, 403);
  }
  async users(actor: User, input: AdminUsersDto) {
    this.admin(actor);
    const query = this.db
      .getRepository(User)
      .createQueryBuilder('user')
      .orderBy('user.id', 'ASC')
      .take(input.limit + 1);
    if (input.query)
      query.andWhere(
        '(user.displayName ILIKE :term OR user.email ILIKE :term)',
        { term: `%${input.query.replace(/[\\%_]/g, '\\$&')}%` },
      );
    if (input.cursor)
      query.andWhere('user.id > :cursor', { cursor: input.cursor });
    return pageResult(
      (await query.getMany()).map((u) => ({
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
      })),
      input.limit,
    );
  }
  async status(actor: User, userId: string, status: 'active' | 'blocked') {
    this.admin(actor);
    if (actor.id === userId)
      throw new HttpException({ code: 'CANNOT_BLOCK_SELF' }, 403);
    const result = await this.db.transaction(async (manager) => {
      // Match refresh/password-change ordering: session locks precede user lock.
      await manager
        .getRepository(Session)
        .createQueryBuilder('s')
        .where('s.userId = :userId AND s.revokedAt IS NULL', { userId })
        .orderBy('s.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new HttpException({ code: 'USER_NOT_FOUND' }, 404);
      if (user.role === 'admin')
        throw new HttpException({ code: 'ADMIN_ACCOUNT_PROTECTED' }, 403);
      if (user.status === 'deleted')
        throw new HttpException({ code: 'USER_UNAVAILABLE' }, 409);
      if (status === 'blocked')
        await manager
          .getRepository(Session)
          .createQueryBuilder()
          .update()
          .set({ revokedAt: () => 'GREATEST(CURRENT_TIMESTAMP, created_at)' })
          .where({ userId, revokedAt: IsNull() })
          .execute();
      await manager.getRepository(User).update(userId, { status });
      await manager.getRepository(AuditLog).insert({
        actorId: actor.id,
        action: `user.${status}`,
        targetType: 'user',
        targetId: userId,
        metadata: { previousStatus: user.status },
      });
      return { id: userId, status };
    });
    this.events.accessChanged(userId, status);
    return result;
  }
  async sessions(userId: string, currentId: string) {
    const rows = await this.db.getRepository(Session).find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
    return {
      items: rows.map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        current: s.id === currentId,
      })),
    };
  }
  async revoke(userId: string, id: string) {
    const repo = this.db.getRepository(Session);
    if (!(await repo.existsBy({ id, userId })))
      throw new HttpException({ code: 'SESSION_NOT_FOUND' }, 404);
    await repo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: () => 'GREATEST(CURRENT_TIMESTAMP, created_at)' })
      .where({ id, userId, revokedAt: IsNull() })
      .execute();
    this.events.accessChanged(userId);
    return { success: true };
  }
}
