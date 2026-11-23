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
  const repository = manager.getRepository(Notification);
  if (deduplicationKey) {
    const exists = await repository.findOne({
      where: { userId, deduplicationKey },
      lock: { mode: 'pessimistic_write' },
    });
    if (exists) return;
  }
  await repository.insert({ userId, type, payload, deduplicationKey });
}
