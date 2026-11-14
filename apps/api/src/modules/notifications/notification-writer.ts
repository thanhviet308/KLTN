import type { EntityManager } from 'typeorm';
import { Notification } from '../database/entities/notification.entity';

// Use the caller's transaction so an event and its notification commit together.
export async function writeNotification(
  manager: EntityManager,
  userId: string,
  type: Notification['type'],
  payload: Record<string, string>,
  deduplicationKey: string | null = null,
) {
  await manager
    .getRepository(Notification)
    .createQueryBuilder()
    .insert()
    .values({ userId, type, payload, deduplicationKey })
    .orIgnore()
    .execute();
}
