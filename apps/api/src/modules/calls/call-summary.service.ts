import { HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { DataSource, IsNull } from 'typeorm';
import {
  AiProviderService,
  normalizeAudioMime,
} from '../ai/ai-provider.service';
import { Call } from '../database/entities/call.entity';
import { ConversationMemberPeriod } from '../database/entities/conversation-member-period.entity';
import { Message } from '../database/entities/message.entity';
import { MessagesService } from '../messages/messages.service';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
function fail(status: number, code: string): never {
  throw new HttpException({ code, message: code }, status);
}

export function callSummaryRequestId(callId: string) {
  const hex = createHash('sha256')
    .update(`call-summary:${callId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

@Injectable()
export class CallSummaryService {
  private readonly active = new Set<string>();
  private readonly quotas = new Map<string, { count: number; until: number }>();

  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(AiProviderService) private readonly provider: AiProviderService,
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {}

  async summarize(actorId: string, callId: string, request: Request) {
    const call = await this.db.getRepository(Call).findOneBy({ id: callId });
    if (!call || call.initiatorId !== actorId) fail(404, 'CALL_NOT_FOUND');
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
    const clientMessageId = callSummaryRequestId(callId);
    const existing = await this.db.getRepository(Message).findOneBy({
      senderId: actorId,
      clientMessageId,
    });
    if (existing) return { messageId: existing.id };
    if (!this.provider.available()) fail(503, 'AI_NOT_CONFIGURED');
    const mimeType = normalizeAudioMime(request.headers['content-type']);
    if (mimeType !== 'audio/webm' && mimeType !== 'audio/mp4')
      fail(415, 'INVALID_AUDIO');
    if (Number(request.headers['content-length'] ?? 0) > MAX_AUDIO_BYTES)
      fail(413, 'FILE_TOO_LARGE');
    if (this.active.has(actorId) || this.active.size >= 2) fail(429, 'AI_BUSY');
    this.active.add(actorId);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60000);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      // Authentication and call authorization happen before consuming the upload.
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
      const result = await this.provider.summarizeCallAudio(audio, mimeType);
      const body = [
        'Tóm tắt cuộc gọi · AI',
        result.summary,
        result.decisions.length
          ? `Quyết định:\n${result.decisions.map((item) => `• ${item}`).join('\n')}`
          : '',
        result.tasks.length
          ? `Việc cần làm:\n${result.tasks.map((item) => `• ${item}`).join('\n')}`
          : '',
        'Nội dung do AI tạo từ âm thanh thu được; hãy kiểm tra lại các chi tiết.',
      ]
        .filter(Boolean)
        .join('\n\n');
      if (body.length > 10000) fail(502, 'AI_INVALID_OUTPUT');
      const created = await this.messages.send(actorId, call.conversationId, {
        type: 'text',
        clientMessageId,
        body,
      });
      return { messageId: created.message.id, message: created.message };
    } finally {
      clearTimeout(timer);
      this.active.delete(actorId);
    }
  }
}
