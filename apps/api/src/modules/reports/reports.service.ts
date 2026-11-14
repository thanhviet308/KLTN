import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DataSource, In, MoreThan } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Report } from '../database/entities/report.entity';
import { User } from '../database/entities/user.entity';
import { Message } from '../database/entities/message.entity';
import { Call } from '../database/entities/call.entity';
import { CallParticipant } from '../database/entities/call-participant.entity';
import { Attachment } from '../database/entities/attachment.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { writeNotification } from '../notifications/notification-writer';
import { pageResult } from '../../common/page.dto';
import type { PageDto } from '../../common/page.dto';
import type { CreateReportDto, ReviewReportDto } from './reports.dto';

function fail(status: number, code: string): never {
  throw new HttpException({ code, message: code }, status);
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
  ) {}

  private admin(user: User) {
    if (user.role !== 'admin') fail(403, 'ADMIN_REQUIRED');
  }

  private async visibleMessage(
    manager: EntityManager,
    actorId: string,
    id: string,
  ) {
    const message = await manager
      .getRepository(Message)
      .createQueryBuilder('message')
      .where('message.id = :id AND message.deletedAt IS NULL', { id })
      .andWhere(
        `EXISTS (SELECT 1 FROM conversation_member_periods period
        WHERE period.conversation_id = message.conversation_id AND period.user_id = :actorId
        AND message.sequence > period.joined_after_sequence
        AND (period.left_after_sequence IS NULL OR message.sequence <= period.left_after_sequence))`,
        { actorId },
      )
      .getOne();
    if (!message) fail(404, 'REPORT_TARGET_UNAVAILABLE');
    await this.conversations.requireAccess(
      manager,
      message.conversationId,
      actorId,
    );
    return message;
  }

  private async snapshot(
    manager: EntityManager,
    actorId: string,
    input: CreateReportDto,
  ): Promise<Record<string, unknown>> {
    if (input.targetType === 'user') {
      if (input.targetId === actorId) fail(400, 'REPORT_SELF');
      const user = await manager
        .getRepository(User)
        .findOneBy({ id: input.targetId, status: 'active' });
      if (!user) fail(404, 'REPORT_TARGET_UNAVAILABLE');
      return { displayName: user.displayName, userId: user.id };
    }
    if (input.targetType === 'call') {
      const participant = await manager
        .getRepository(CallParticipant)
        .findOneBy({ callId: input.targetId, userId: actorId });
      if (!participant) fail(404, 'REPORT_TARGET_UNAVAILABLE');
      const call = await manager
        .getRepository(Call)
        .findOneBy({ id: input.targetId });
      if (!call) fail(404, 'REPORT_TARGET_UNAVAILABLE');
      return {
        callId: call.id,
        conversationId: call.conversationId,
        initiatorId: call.initiatorId,
        type: call.type,
        status: call.status,
        createdAt: call.createdAt,
      };
    }
    if (input.targetType === 'attachment') {
      const attachment = await manager
        .getRepository(Attachment)
        .findOneBy({ id: input.targetId, status: 'attached' });
      if (!attachment?.messageId || !attachment.mimeType.startsWith('image/'))
        fail(404, 'REPORT_TARGET_UNAVAILABLE');
      const message = await this.visibleMessage(
        manager,
        actorId,
        attachment.messageId,
      );
      return {
        attachmentId: attachment.id,
        messageId: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
      };
    }
    const message = await this.visibleMessage(manager, actorId, input.targetId);
    return {
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      type: message.type,
      body: message.editedBody ?? message.body,
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  async create(actorId: string, input: CreateReportDto) {
    return this.db.transaction(async (manager) => {
      // Serialize per reporter: repeated submissions and the quota are atomic.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`reports:${actorId}`],
      );
      const snapshot = await this.snapshot(manager, actorId, input);
      const repository = manager.getRepository(Report);
      const existing = await repository.findOneBy({
        reporterId: actorId,
        targetType: input.targetType,
        targetId: input.targetId,
        status: In(['open', 'reviewing']),
      });
      if (existing)
        return {
          report: { id: existing.id, status: existing.status },
          duplicate: true,
        };
      if (
        (await repository.countBy({
          reporterId: actorId,
          createdAt: MoreThan(new Date(Date.now() - 3600000)),
        })) >= 20
      )
        fail(429, 'REPORT_RATE_LIMIT');
      const fields = {
        user: 'reportedUserId',
        message: 'reportedMessageId',
        call: 'reportedCallId',
        attachment: 'reportedAttachmentId',
      } as const;
      const row = await repository.save(
        repository.create({
          reporterId: actorId,
          targetType: input.targetType,
          [fields[input.targetType]]: input.targetId,
          reason: input.reason,
          snapshot,
          status: 'open',
        }),
      );
      return { report: { id: row.id, status: row.status }, duplicate: false };
    });
  }

  async queue(user: User, input: PageDto) {
    this.admin(user);
    const repository = this.db.getRepository(Report);
    const query = repository
      .createQueryBuilder('report')
      .addSelect('report.snapshot')
      .orderBy('report.createdAt', 'DESC')
      .addOrderBy('report.id', 'DESC')
      .take(input.limit + 1);
    if (input.cursor) {
      if (!(await repository.existsBy({ id: input.cursor })))
        fail(400, 'INVALID_CURSOR');
      query.where(
        '(report.createdAt, report.id) < ((SELECT created_at FROM reports WHERE id = :cursor), :cursor)',
        { cursor: input.cursor },
      );
    }
    const [rows, pendingCount] = await Promise.all([
      query.getMany(),
      repository.countBy({ status: In(['open', 'reviewing']) }),
    ]);
    return { ...pageResult(rows, input.limit), pendingCount };
  }

  async image(user: User, id: string) {
    this.admin(user);
    const report = await this.db.getRepository(Report).findOneBy({ id });
    if (!report) fail(404, 'REPORT_NOT_FOUND');
    // Only an image explicitly attached to this report can be inspected.
    const attachment = await this.db
      .getRepository(Attachment)
      .createQueryBuilder('attachment')
      .addSelect('attachment.objectKey')
      .where(
        report.reportedAttachmentId
          ? 'attachment.id = :id'
          : 'attachment.messageId = :id',
        {
          id: report.reportedAttachmentId ?? report.reportedMessageId,
        },
      )
      .andWhere(
        "attachment.status = 'attached' AND attachment.mimeType IN ('image/webp', 'image/png', 'image/jpeg')",
      )
      .getOne();
    if (!attachment) fail(404, 'REPORT_TARGET_UNAVAILABLE');
    return attachment;
  }

  async review(user: User, id: string, input: ReviewReportDto) {
    this.admin(user);
    return this.db.transaction(async (manager) => {
      const repository = manager.getRepository(Report);
      const row = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) fail(404, 'REPORT_NOT_FOUND');
      if (row.reporterId === user.id) fail(403, 'REPORT_SELF_REVIEW');
      if (row.status === 'resolved' || row.status === 'dismissed')
        fail(409, 'REPORT_CLOSED');
      if (row.reviewerId && row.reviewerId !== user.id)
        fail(409, 'REPORT_ASSIGNED');
      row.status = input.status;
      row.reviewerId = user.id;
      row.resolution = input.status === 'reviewing' ? null : input.resolution;
      row.reviewedAt =
        input.status === 'reviewing'
          ? null
          : new Date(Math.max(Date.now(), row.createdAt.getTime()));
      await repository.save(row);
      if (row.reviewedAt)
        await writeNotification(
          manager,
          row.reporterId,
          'report_updated',
          {
            title:
              input.status === 'resolved'
                ? 'Báo cáo của bạn đã được xử lý'
                : 'Báo cáo của bạn đã được xem xét',
            reportId: row.id,
          },
          `report_review:${row.id}`,
        );
      return { report: row };
    });
  }
}
