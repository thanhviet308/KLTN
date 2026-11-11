import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { ConversationsService } from '../conversations/conversations.service';
import { Message } from '../database/entities/message.entity';
import { AiProviderService, aiError } from './ai-provider.service';
import type { AiChatRequestDto, AiRequestDto } from './ai.dto';

@Injectable()
export class AiService {
  private running = new Set<string>();
  private limits = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
    @Inject(AiProviderService) private readonly provider: AiProviderService,
  ) {}

  private consumeQuota(actorId: string) {
    const now = Date.now();
    for (const [id, entry] of this.limits)
      if (entry.until <= now) this.limits.delete(id);
    if (!this.limits.has(actorId) && this.limits.size >= 10000)
      aiError(503, 'AI_BUSY');
    const quota = this.limits.get(actorId) ?? {
      count: 0,
      until: now + 3600000,
    };
    if (quota.count >= 20) aiError(429, 'AI_QUOTA_EXCEEDED');
    quota.count++;
    this.limits.set(actorId, quota);
  }

  private async sources(
    actorId: string,
    conversationId: string,
    ids: string[],
  ) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      const rows = await manager
        .getRepository(Message)
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.senderMember', 'member')
        .leftJoin('member.user', 'sender')
        .addSelect(['sender.id', 'sender.displayName'])
        .where('message.conversationId = :conversationId', { conversationId })
        .andWhere('message.id IN (:...ids)', { ids })
        .andWhere("message.type = 'text' AND message.deletedAt IS NULL")
        .andWhere(
          `EXISTS (SELECT 1 FROM conversation_member_periods period
          WHERE period.conversation_id = message.conversation_id AND period.user_id = :actorId
          AND message.sequence > period.joined_after_sequence
          AND (period.left_after_sequence IS NULL OR message.sequence <= period.left_after_sequence))`,
          { actorId },
        )
        .orderBy('message.sequence', 'ASC')
        .getMany();
      if (rows.length !== ids.length) aiError(404, 'AI_SOURCE_UNAVAILABLE');
      return rows.map((row) => ({
        id: row.id,
        sender:
          row.senderId === actorId ? 'Bạn' : row.senderMember.user.displayName,
        body: row.editedBody ?? row.body ?? '',
        createdAt: row.createdAt.toISOString(),
        revision: createHash('sha256')
          .update(
            JSON.stringify([
              row.id,
              row.editedAt?.toISOString() ?? null,
              row.editedBody ?? row.body ?? '',
            ]),
          )
          .digest('hex'),
      }));
    });
  }

  async generate(actorId: string, conversationId: string, input: AiRequestDto) {
    if (
      !input.messageIds.length ||
      input.messageIds.length > 50 ||
      new Set(input.messageIds).size !== input.messageIds.length
    )
      aiError(400, 'AI_INPUT_INVALID');
    if (input.sourceRevisions.length !== input.messageIds.length)
      aiError(400, 'AI_INPUT_INVALID');
    if (input.kind === 'translate' && input.messageIds.length !== 1)
      aiError(400, 'AI_INPUT_INVALID');
    if (
      input.kind === 'replies' &&
      (!input.targetMessageId ||
        !input.messageIds.includes(input.targetMessageId))
    )
      aiError(400, 'AI_INPUT_INVALID');
    if (!this.provider.available()) aiError(503, 'AI_NOT_CONFIGURED');
    if (this.running.has(actorId) || this.running.size >= 2)
      aiError(429, 'AI_BUSY');
    this.running.add(actorId);
    try {
      const messages = await this.sources(
        actorId,
        conversationId,
        input.messageIds,
      );
      if (
        messages.some(
          (item) =>
            item.revision !==
            input.sourceRevisions[input.messageIds.indexOf(item.id)],
        )
      )
        aiError(409, 'AI_SOURCE_CHANGED');
      if (
        input.kind === 'replies' &&
        messages.at(-1)?.id !== input.targetMessageId
      )
        aiError(400, 'AI_INPUT_INVALID');
      if (!messages.some((item) => item.body.trim()))
        aiError(400, 'AI_INPUT_EMPTY');
      if (
        messages.reduce(
          (sum, item) => sum + item.body.length + item.sender.length,
          0,
        ) > 24000
      )
        aiError(413, 'AI_INPUT_TOO_LARGE');
      this.consumeQuota(actorId);
      const result = await this.provider.generate(
        input,
        messages.map(({ id, sender, body, createdAt }) => ({
          id,
          sender,
          body,
          createdAt,
        })),
      );
      // Recheck membership and revisions after the provider call; never return results
      // based on recalled messages or content from a conversation the user has left.
      const current = await this.sources(
        actorId,
        conversationId,
        input.messageIds,
      );
      if (
        current.some(
          (item, index) =>
            item.id !== messages[index]?.id ||
            item.revision !== messages[index]?.revision,
        )
      )
        aiError(409, 'AI_SOURCE_CHANGED');
      return { kind: input.kind, messageIds: input.messageIds, result };
    } finally {
      this.running.delete(actorId);
    }
  }

  async chat(actorId: string, input: AiChatRequestDto) {
    if (
      !Array.isArray(input.messages) ||
      !input.messages.length ||
      input.messages.length > 20
    )
      aiError(400, 'AI_INPUT_INVALID');
    const normalized = input.messages.map((turn) => ({
      role: turn.role,
      text: typeof turn.text === 'string' ? turn.text.trim() : '',
    }));
    if (
      normalized.some(
        (turn) => (turn.role !== 'user' && turn.role !== 'model') || !turn.text,
      ) ||
      normalized.at(-1)?.role !== 'user'
    )
      aiError(400, 'AI_INPUT_INVALID');
    if (normalized.some((turn) => turn.text.length > 4000))
      aiError(413, 'AI_INPUT_TOO_LARGE');
    if (normalized.reduce((sum, turn) => sum + turn.text.length, 0) > 16000)
      aiError(413, 'AI_INPUT_TOO_LARGE');
    if (!this.provider.available()) aiError(503, 'AI_NOT_CONFIGURED');
    if (this.running.has(actorId) || this.running.size >= 2)
      aiError(429, 'AI_BUSY');
    this.running.add(actorId);
    try {
      this.consumeQuota(actorId);
      const result = await this.provider.chat(normalized);
      return { result };
    } finally {
      this.running.delete(actorId);
    }
  }
}
