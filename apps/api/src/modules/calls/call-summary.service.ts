import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Request } from 'express';
import { DataSource, IsNull } from 'typeorm';
import {
  AiProviderService,
  normalizeAudioMime,
} from '../ai/ai-provider.service';
import { Call } from '../database/entities/call.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import { ConversationMemberPeriod } from '../database/entities/conversation-member-period.entity';
import { Message } from '../database/entities/message.entity';
import { ChatFilesService } from '../messages/chat-files.service';
import { RealtimeEvents } from '../realtime/realtime-events.module';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export interface CallSummaryPayload {
  summary: string;
  decisions: string[];
  tasks: string[];
}

function fail(status: number, code: string): never {
  throw new HttpException({ code, message: code }, status);
}

export function callSummaryRequestId(callId: string) {
  const hex = createHash('sha256')
    .update(`call-summary:${callId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function parseCachedSummary(raw: string | null): CallSummaryPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CallSummaryPayload>;
    if (
      typeof parsed?.summary === 'string' &&
      Array.isArray(parsed.decisions) &&
      Array.isArray(parsed.tasks)
    ) {
      return {
        summary: parsed.summary,
        decisions: parsed.decisions.filter(
          (item): item is string => typeof item === 'string',
        ),
        tasks: parsed.tasks.filter(
          (item): item is string => typeof item === 'string',
        ),
      };
    }
  } catch {
    // Re-generate if stored payload cannot be parsed.
  }
  return null;
}

@Injectable()
export class CallSummaryService {
  private readonly activeUploads = new Set<string>();
  private readonly activeSummaries = new Set<string>();
  private readonly pendingByCall = new Map<
    string,
    Promise<CallSummaryPayload>
  >();
  private readonly quotas = new Map<string, { count: number; until: number }>();

  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(AiProviderService) private readonly provider: AiProviderService,
    @Inject(ChatFilesService) private readonly files: ChatFilesService,
    @Optional()
    @Inject(RealtimeEvents)
    private readonly events?: RealtimeEvents,
  ) {}

  private messageView(message: Message) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      clientMessageId: message.clientMessageId,
      sequence: message.sequence,
      type: message.type,
      body: message.body,
      content: message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
    };
  }

  async uploadRecording(actorId: string, callId: string, request: Request) {
    const call = await this.db.getRepository(Call).findOneBy({ id: callId });
    const recorderId = call ? (call.summaryRecorderId ?? call.initiatorId) : '';
    if (!call || recorderId !== actorId) fail(404, 'CALL_NOT_FOUND');
    if (!call.summaryEnabled || call.status !== 'ended')
      fail(409, 'CALL_SUMMARY_NOT_READY');
    const member = await this.db
      .getRepository(ConversationMemberPeriod)
      .findOneBy({
        conversationId: call.conversationId,
        userId: actorId,
        leftAt: IsNull(),
      });
    if (!member) fail(404, 'CALL_NOT_FOUND');
    if (call.summaryAudioKey) {
      return { callId: call.id, summaryAvailable: true };
    }
    const mimeType = normalizeAudioMime(request.headers['content-type']);
    if (mimeType !== 'audio/webm' && mimeType !== 'audio/mp4')
      fail(415, 'INVALID_AUDIO');
    if (Number(request.headers['content-length'] ?? 0) > MAX_AUDIO_BYTES)
      fail(413, 'FILE_TOO_LARGE');
    if (this.activeUploads.has(actorId) || this.activeUploads.size >= 4)
      fail(429, 'AI_BUSY');
    this.activeUploads.add(actorId);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60000);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      const { addAbortSignal } = await import('node:stream');
      addAbortSignal(abort.signal, request);
      try {
        for await (const chunk of request) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_AUDIO_BYTES) fail(413, 'FILE_TOO_LARGE');
          chunks.push(bytes);
        }
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (
          abort.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        )
          fail(408, 'UPLOAD_TIMEOUT');
        if (
          request.destroyed ||
          (error &&
            typeof error === 'object' &&
            'code' in error &&
            ['ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes(
              String(error.code),
            ))
        )
          fail(400, 'INVALID_AUDIO');
        throw error;
      }
      clearTimeout(timer);
      if (!size) fail(400, 'INVALID_AUDIO');
      const audio = Buffer.concat(chunks);
      const isWebm =
        mimeType === 'audio/webm' &&
        audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
        audio.subarray(0, 4096).includes(Buffer.from('webm'));
      const isMp4 =
        mimeType === 'audio/mp4' && audio.subarray(4, 8).toString() === 'ftyp';
      if (!isWebm && !isMp4) fail(400, 'INVALID_AUDIO');

      const audioKey = await this.files.saveBuffer(audio);
      let updatedMessage: Message | null = null;
      try {
        await this.db.transaction(async (manager) => {
          const calls = manager.getRepository(Call);
          const locked = await calls.findOne({
            where: { id: callId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked) {
            await this.files.remove(audioKey).catch(() => undefined);
            fail(404, 'CALL_NOT_FOUND');
          }
          if (locked.summaryAudioKey) {
            await this.files.remove(audioKey).catch(() => undefined);
            return;
          }
          locked.summaryAudioKey = audioKey;
          locked.summaryAudioMime = mimeType;
          await calls.save(locked);

          const messages = manager.getRepository(Message);
          const callMessage = await messages.findOneBy({
            senderId: locked.initiatorId,
            clientMessageId: locked.id,
          });
          if (callMessage && !callMessage.deletedAt) {
            callMessage.content = {
              ...(callMessage.content ?? {}),
              summaryAvailable: true,
            };
            updatedMessage = await messages.save(callMessage);
          }
        });
      } catch (error) {
        await this.files.remove(audioKey).catch(() => undefined);
        throw error;
      }

      const view = updatedMessage
        ? this.messageView(updatedMessage)
        : undefined;
      if (view) {
        this.events?.publish({
          name: 'message:updated',
          conversationId: view.conversationId,
          messageId: view.id,
          payload: view,
        });
      }
      return {
        callId: call.id,
        summaryAvailable: true,
        ...(view ? { message: view } : {}),
      };
    } finally {
      clearTimeout(timer);
      this.activeUploads.delete(actorId);
    }
  }

  async summarize(actorId: string, callId: string) {
    const call = await this.db.getRepository(Call).findOneBy({ id: callId });
    if (!call) fail(404, 'CALL_NOT_FOUND');

    const periods = await this.db.getRepository(ConversationMemberPeriod).find({
      where: { conversationId: call.conversationId, userId: actorId },
    });
    if (!periods.some((period) => period.leftAt === null))
      fail(404, 'CALL_NOT_FOUND');

    const member = await this.db.getRepository(ConversationMember).findOneBy({
      conversationId: call.conversationId,
      userId: actorId,
    });
    if (!member) fail(404, 'CALL_NOT_FOUND');

    const callMessage = await this.db.getRepository(Message).findOneBy({
      senderId: call.initiatorId,
      clientMessageId: call.id,
      deletedAt: IsNull(),
    });
    if (!callMessage) fail(404, 'CALL_NOT_FOUND');

    if (
      member.clearedAfterSequence &&
      BigInt(callMessage.sequence) <= BigInt(member.clearedAfterSequence)
    )
      fail(404, 'CALL_NOT_FOUND');

    const visibleInPeriod = periods.some(
      (period) =>
        period.joinedAt.getTime() <= callMessage.createdAt.getTime() &&
        (!period.leftAt ||
          period.leftAt.getTime() >= callMessage.createdAt.getTime()),
    );
    if (!visibleInPeriod) fail(404, 'CALL_NOT_FOUND');

    if (
      !call.summaryEnabled ||
      call.status !== 'ended' ||
      !call.summaryAudioKey ||
      !call.summaryAudioMime
    )
      fail(409, 'CALL_SUMMARY_NOT_READY');

    const cached = parseCachedSummary(call.summaryPayload);
    if (cached) {
      return { callId: call.id, result: cached };
    }

    const inflight = this.pendingByCall.get(call.id);
    if (inflight) {
      return { callId: call.id, result: await inflight };
    }

    if (!this.provider.available()) fail(503, 'AI_NOT_CONFIGURED');
    if (this.activeSummaries.has(actorId) || this.activeSummaries.size >= 2)
      fail(429, 'AI_BUSY');

    const audioKey = call.summaryAudioKey;
    const audioMime = call.summaryAudioMime;
    let audio: Buffer;
    try {
      audio = await readFile(this.files.path(audioKey));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        fail(404, 'CALL_NOT_FOUND');
      throw error;
    }
    if (!audio.length) fail(400, 'INVALID_AUDIO');

    const now = Date.now();
    for (const [id, quota] of this.quotas) {
      if (quota.until <= now) this.quotas.delete(id);
    }
    const quota = this.quotas.get(actorId) ?? {
      count: 0,
      until: now + 3600000,
    };
    if (quota.count >= 20) fail(429, 'AI_QUOTA_EXCEEDED');
    if (!this.quotas.has(actorId) && this.quotas.size >= 10000)
      fail(503, 'AI_BUSY');
    quota.count++;
    this.quotas.set(actorId, quota);

    this.activeSummaries.add(actorId);
    const generation = (async (): Promise<CallSummaryPayload> => {
      const generated = await this.provider.summarizeCallAudio(
        audio,
        audioMime,
      );
      const payload: CallSummaryPayload = {
        summary: generated.summary,
        decisions: generated.decisions,
        tasks: generated.tasks,
      };
      const serialized = JSON.stringify(payload);
      if (serialized.length > 20000) fail(502, 'AI_INVALID_OUTPUT');
      call.summaryPayload = serialized;
      await this.db.getRepository(Call).save(call);
      return payload;
    })();
    this.pendingByCall.set(call.id, generation);

    try {
      const result = await generation;
      return { callId: call.id, result };
    } finally {
      this.pendingByCall.delete(call.id);
      this.activeSummaries.delete(actorId);
    }
  }
}
