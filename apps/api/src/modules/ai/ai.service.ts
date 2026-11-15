import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { writeNotification } from '../notifications/notification-writer';
import { ConversationsService } from '../conversations/conversations.service';
import { Attachment } from '../database/entities/attachment.entity';
import { Message } from '../database/entities/message.entity';
import { ChatFilesService } from '../messages/chat-files.service';
import {
  AiProviderService,
  aiError,
  normalizeAudioMime,
  type AiSource,
} from './ai-provider.service';
import type {
  AiChatRequestDto,
  AiRequestDto,
  AiTranscribeDto,
  AiTranscriptResult,
} from './ai.dto';

const MAX_TRANSCRIPT_CACHE = 500;
const MAX_VOICE_AI_BYTES = 10 * 1024 * 1024;

@Injectable()
export class AiService {
  private running = new Set<string>();
  private limits = new Map<string, { count: number; until: number }>();
  private transcripts = new Map<
    string,
    {
      transcript: string;
      language: string;
      translations: Record<string, string>;
    }
  >();
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
    @Inject(AiProviderService) private readonly provider: AiProviderService,
    @Optional()
    @Inject(ChatFilesService)
    private readonly files?: ChatFilesService,
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

  private visibleMessageQuery(
    manager: EntityManager,
    actorId: string,
    conversationId: string,
  ) {
    return manager
      .getRepository(Message)
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.senderMember', 'member')
      .leftJoin('member.user', 'sender')
      .addSelect(['sender.id', 'sender.displayName'])
      .where('message.conversationId = :conversationId', { conversationId })
      .andWhere(
        "EXISTS (SELECT 1 FROM users visible_sender WHERE visible_sender.id=message.sender_id AND visible_sender.status='active')",
      )
      .andWhere(
        `EXISTS (SELECT 1 FROM conversation_member_periods period
          WHERE period.conversation_id = message.conversation_id AND period.user_id = :actorId
          AND message.sequence > period.joined_after_sequence
          AND (period.left_after_sequence IS NULL OR message.sequence <= period.left_after_sequence))`,
        { actorId },
      );
  }

  private async sources(
    actorId: string,
    conversationId: string,
    ids: string[],
  ) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      const rows = await this.visibleMessageQuery(
        manager,
        actorId,
        conversationId,
      )
        .andWhere('message.id IN (:...ids)', { ids })
        .andWhere("message.type = 'text' AND message.deletedAt IS NULL")
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
      await this.db.transaction((manager) =>
        writeNotification(manager, actorId, 'ai_completed', {
          title: 'AI đã hoàn thành yêu cầu của bạn',
          conversationId,
          kind: input.kind,
        }),
      );
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
      await this.db.transaction((manager) =>
        writeNotification(manager, actorId, 'ai_completed', {
          title: 'PingPong AI đã trả lời bạn',
        }),
      );
      return { result };
    } finally {
      this.running.delete(actorId);
    }
  }

  private async voiceSource(
    actorId: string,
    conversationId: string,
    messageId: string,
    includeContext: boolean,
  ) {
    return this.db.transaction(async (manager) => {
      await this.conversations.requireAccess(manager, conversationId, actorId);
      const voiceMessage = await this.visibleMessageQuery(
        manager,
        actorId,
        conversationId,
      )
        .andWhere('message.id = :messageId', { messageId })
        .andWhere("message.type = 'voice' AND message.deletedAt IS NULL")
        .getOne();
      if (!voiceMessage) aiError(404, 'AI_SOURCE_UNAVAILABLE');
      const attachment = await manager
        .getRepository(Attachment)
        .createQueryBuilder('attachment')
        .addSelect('attachment.objectKey')
        .where(
          'attachment.messageId = :messageId AND attachment.status = :status',
          { messageId: voiceMessage.id, status: 'attached' },
        )
        .getOne();
      if (!attachment) aiError(404, 'AI_SOURCE_UNAVAILABLE');
      const recentContext: AiSource[] = [];
      if (includeContext) {
        const recentRows = await this.visibleMessageQuery(
          manager,
          actorId,
          conversationId,
        )
          .andWhere('message.sequence < :sequence', {
            sequence: voiceMessage.sequence,
          })
          .andWhere("message.type = 'text' AND message.deletedAt IS NULL")
          .orderBy('message.sequence', 'DESC')
          .limit(9)
          .getMany();
        for (const row of recentRows.reverse()) {
          const text = (row.editedBody ?? row.body ?? '').trim();
          if (!text) continue;
          recentContext.push({
            id: row.id,
            sender:
              row.senderId === actorId
                ? 'Bạn'
                : (row.senderMember?.user?.displayName ?? 'Thành viên'),
            body: text,
            createdAt: row.createdAt.toISOString(),
          });
        }
      }
      return {
        attachment,
        sender:
          voiceMessage.senderId === actorId
            ? 'Bạn'
            : (voiceMessage.senderMember?.user?.displayName ?? 'Thành viên'),
        createdAt: voiceMessage.createdAt.toISOString(),
        recentContext,
      };
    });
  }

  private rememberTranscript(
    cacheKey: string,
    value: {
      transcript: string;
      language: string;
      translations: Record<string, string>;
    },
  ) {
    if (
      !this.transcripts.has(cacheKey) &&
      this.transcripts.size >= MAX_TRANSCRIPT_CACHE
    ) {
      const oldestKey = this.transcripts.keys().next().value;
      if (oldestKey !== undefined) this.transcripts.delete(oldestKey);
    }
    this.transcripts.set(cacheKey, value);
  }

  async transcribeVoice(
    actorId: string,
    conversationId: string,
    messageId: string,
    input: AiTranscribeDto = {},
  ): Promise<{ messageId: string; result: AiTranscriptResult }> {
    if (!this.provider.available()) aiError(503, 'AI_NOT_CONFIGURED');
    if (!this.files) aiError(503, 'AI_UNAVAILABLE');
    if (this.running.has(actorId) || this.running.size >= 2)
      aiError(429, 'AI_BUSY');
    this.running.add(actorId);
    try {
      const source = await this.voiceSource(
        actorId,
        conversationId,
        messageId,
        !!input.includeReplies,
      );
      const mimeType = normalizeAudioMime(source.attachment.mimeType);
      if (!mimeType) aiError(400, 'AI_INPUT_INVALID');
      const cacheKey = `${source.attachment.id}:${source.attachment.objectKey}`;
      let entry = this.transcripts.get(cacheKey);
      if (!entry) {
        let bytes: Buffer;
        try {
          bytes = await readFile(this.files.path(source.attachment.objectKey));
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            aiError(404, 'AI_SOURCE_UNAVAILABLE');
          throw error;
        }
        if (!bytes.length) aiError(400, 'AI_INPUT_EMPTY');
        if (bytes.length > MAX_VOICE_AI_BYTES)
          aiError(413, 'AI_INPUT_TOO_LARGE');
        this.consumeQuota(actorId);
        const transcribed = await this.provider.transcribeAudio(
          bytes.toString('base64'),
          mimeType,
        );
        entry = {
          transcript: transcribed.transcript,
          language: transcribed.language,
          translations: {},
        };
        this.rememberTranscript(cacheKey, entry);
      }

      let translation = '';
      if (input.translateTo && entry.transcript) {
        const cachedTranslation = entry.translations[input.translateTo];
        if (cachedTranslation) {
          translation = cachedTranslation;
        } else {
          this.consumeQuota(actorId);
          const translated = await this.provider.generate(
            {
              kind: 'translate',
              messageIds: [messageId],
              sourceRevisions: [],
              language: input.translateTo,
            },
            [
              {
                id: messageId,
                sender: source.sender,
                body: entry.transcript,
                createdAt: source.createdAt,
              },
            ],
          );
          translation = translated.translation;
          entry.translations[input.translateTo] = translation;
        }
      }

      let replies: string[] = [];
      if (input.includeReplies && entry.transcript) {
        this.consumeQuota(actorId);
        const contextMessages: AiSource[] = [
          ...source.recentContext,
          {
            id: messageId,
            sender: source.sender,
            body: entry.transcript,
            createdAt: source.createdAt,
          },
        ];
        const suggested = await this.provider.generate(
          {
            kind: 'replies',
            messageIds: contextMessages.map((item) => item.id),
            sourceRevisions: [],
            targetMessageId: messageId,
            tone: input.tone ?? 'concise',
          },
          contextMessages,
        );
        replies = suggested.replies;
      }

      // Recheck membership and visibility after provider calls so recalled voice
      // notes or revoked access never expose transcribed text.
      try {
        await this.voiceSource(actorId, conversationId, messageId, false);
      } catch (error) {
        this.transcripts.delete(cacheKey);
        throw error;
      }

      return {
        messageId,
        result: {
          transcript: entry.transcript,
          language: entry.language,
          translation,
          replies,
        },
      };
    } finally {
      this.running.delete(actorId);
    }
  }
}
