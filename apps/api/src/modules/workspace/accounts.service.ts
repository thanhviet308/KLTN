import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource, In, IsNull, MoreThan } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Session } from '../database/entities/session.entity';
import { AuditLog } from '../database/entities/audit-log.entity';
import { pageResult } from '../../common/page.dto';
import type {
  AdminAuditLogsDto,
  AdminDashboardDto,
  AdminUsersDto,
  RetentionPolicyDto,
} from './workspace.dto';
import { RealtimeEvents } from '../realtime/realtime-events.module';
import { ChatFilesService } from '../messages/chat-files.service';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(RealtimeEvents) private readonly events: RealtimeEvents,
    @Optional()
    @Inject(ChatFilesService)
    private readonly files?: ChatFilesService,
  ) {}
  private admin(user: User) {
    if (user.role !== 'admin')
      throw new HttpException({ code: 'ADMIN_REQUIRED' }, 403);
  }
  async dashboard(actor: User, input: AdminDashboardDto) {
    this.admin(actor);
    const days = Math.min(Math.max(Number(input.days || 14), 1), 90);
    const [userRows, totalRows, seriesRows] = await Promise.all([
      this.db.query<
        {
          total: number;
          active: number;
          blocked: number;
          deleted: number;
          admins: number;
        }[]
      >(`SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
          COUNT(*) FILTER (WHERE status = 'deleted')::int AS deleted,
          COUNT(*) FILTER (WHERE role = 'admin')::int AS admins
        FROM users`),
      this.db.query<
        {
          messagesToday: number;
          messagesPeriod: number;
          callsPeriod: number;
          gamesPeriod: number;
          groupsTotal: number;
          pendingReports: number;
          uploadFilesTotal: number;
          uploadBytesTotal: string;
        }[]
      >(
        `SELECT
          (SELECT COUNT(*)::int FROM messages WHERE deleted_at IS NULL AND created_at >= CURRENT_DATE) AS "messagesToday",
          (SELECT COUNT(*)::int FROM messages WHERE deleted_at IS NULL AND created_at >= CURRENT_DATE - ($1::int - 1)) AS "messagesPeriod",
          (SELECT COUNT(*)::int FROM calls WHERE created_at >= CURRENT_DATE - ($1::int - 1)) AS "callsPeriod",
          (SELECT COUNT(*)::int FROM game_sessions WHERE created_at >= CURRENT_DATE - ($1::int - 1)) AS "gamesPeriod",
          (SELECT COUNT(*)::int FROM conversations WHERE type = 'group' AND deleted_at IS NULL) AS "groupsTotal",
          (SELECT COUNT(*)::int FROM reports WHERE status IN ('open', 'reviewing')) AS "pendingReports",
          (SELECT COUNT(*)::int FROM attachments a LEFT JOIN messages m ON m.id = a.message_id WHERE a.status IN ('uploaded', 'attached') AND (a.message_id IS NULL OR m.deleted_at IS NULL)) AS "uploadFilesTotal",
          (SELECT COALESCE(SUM(a.size), 0)::bigint::text FROM attachments a LEFT JOIN messages m ON m.id = a.message_id WHERE a.status IN ('uploaded', 'attached') AND (a.message_id IS NULL OR m.deleted_at IS NULL)) AS "uploadBytesTotal"`,
        [days],
      ),
      this.db.query<
        {
          date: string;
          newUsers: number;
          messages: number;
          calls: number;
          games: number;
        }[]
      >(
        `WITH days AS (
          SELECT generate_series(
            CURRENT_DATE - ($1::int - 1),
            CURRENT_DATE,
            '1 day'::interval
          )::date AS day
        )
        SELECT
          to_char(d.day, 'YYYY-MM-DD') AS date,
          COALESCE((SELECT COUNT(*)::int FROM users u WHERE u.created_at >= d.day AND u.created_at < d.day + 1), 0) AS "newUsers",
          COALESCE((SELECT COUNT(*)::int FROM messages m WHERE m.deleted_at IS NULL AND m.created_at >= d.day AND m.created_at < d.day + 1), 0) AS messages,
          COALESCE((SELECT COUNT(*)::int FROM calls c WHERE c.created_at >= d.day AND c.created_at < d.day + 1), 0) AS calls,
          COALESCE((SELECT COUNT(*)::int FROM game_sessions g WHERE g.created_at >= d.day AND g.created_at < d.day + 1), 0) AS games
        FROM days d
        ORDER BY d.day ASC`,
        [days],
      ),
    ]);
    return {
      days,
      users: userRows[0] ?? {
        total: 0,
        active: 0,
        blocked: 0,
        deleted: 0,
        admins: 0,
      },
      totals: totalRows[0] ?? {
        messagesToday: 0,
        messagesPeriod: 0,
        callsPeriod: 0,
        gamesPeriod: 0,
        groupsTotal: 0,
        pendingReports: 0,
        uploadFilesTotal: 0,
        uploadBytesTotal: '0',
      },
      series: seriesRows,
    };
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
        '(user.displayName ILIKE :term OR user.email ILIKE :term OR CAST(user.id AS text) ILIKE :term)',
        { term: `%${input.query.replace(/[\\%_]/g, '\\$&')}%` },
      );
    if (input.status)
      query.andWhere('user.status = :status', { status: input.status });
    if (input.role) query.andWhere('user.role = :role', { role: input.role });
    if (input.cursor)
      query.andWhere('user.id > :cursor', { cursor: input.cursor });
    return pageResult(
      (await query.getMany()).map((u) => ({
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        role: u.role,
        status: u.status,
        lastActiveAt: u.lastActiveAt,
        createdAt: u.createdAt,
      })),
      input.limit,
    );
  }
  async userOverview(actor: User, userId: string) {
    this.admin(actor);
    const user = await this.db.getRepository(User).findOne({
      where: { id: userId },
      select: [
        'id',
        'email',
        'displayName',
        'role',
        'status',
        'lastActiveAt',
        'createdAt',
        'updatedAt',
      ],
    });
    if (!user) throw new HttpException({ code: 'USER_NOT_FOUND' }, 404);
    const [friends, conversations, uploadSummaryRows, recentUploads] =
      await Promise.all([
        this.db.query<
          {
            id: string;
            email: string;
            displayName: string;
            status: string;
            role: string;
            since: Date;
          }[]
        >(
          `SELECT u.id, u.email, u.display_name AS "displayName", u.status, u.role, f.created_at AS since
           FROM friendships f
           JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.recipient_id ELSE f.requester_id END
           WHERE (f.requester_id = $1 OR f.recipient_id = $1) AND f.status = 'accepted'
           ORDER BY f.created_at DESC
           LIMIT 50`,
          [userId],
        ),
        this.db.query<
          {
            id: string;
            type: 'direct' | 'group';
            title: string | null;
            lastMessageSequence: string;
            createdAt: Date;
            memberRole: string;
            joinedAt: Date;
            memberCount: number;
          }[]
        >(
          `SELECT
             c.id,
             c.type,
             c.title,
             c.last_message_sequence::text AS "lastMessageSequence",
             c.created_at AS "createdAt",
             cm.role AS "memberRole",
             cmp.joined_at AS "joinedAt",
             (SELECT COUNT(*)::int FROM conversation_member_periods p2 WHERE p2.conversation_id = c.id AND p2.left_at IS NULL) AS "memberCount"
           FROM conversation_member_periods cmp
           JOIN conversation_members cm ON cm.conversation_id = cmp.conversation_id AND cm.user_id = cmp.user_id
           JOIN conversations c ON c.id = cmp.conversation_id
           WHERE cmp.user_id = $1 AND cmp.left_at IS NULL AND c.deleted_at IS NULL
           ORDER BY c.updated_at DESC
           LIMIT 50`,
          [userId],
        ),
        this.db.query<{ fileCount: number; totalBytes: string }[]>(
          `SELECT
             COUNT(*)::int AS "fileCount",
             COALESCE(SUM(a.size), 0)::bigint::text AS "totalBytes"
           FROM attachments a
           LEFT JOIN messages m ON m.id = a.message_id
           WHERE a.uploader_id = $1
             AND a.status IN ('uploaded', 'attached')
             AND (a.message_id IS NULL OR m.deleted_at IS NULL)`,
          [userId],
        ),
        this.db.query<
          {
            id: string;
            fileName: string;
            mimeType: string;
            size: string;
            status: string;
            messageId: string | null;
            createdAt: Date;
          }[]
        >(
          `SELECT
             a.id,
             a.file_name AS "fileName",
             a.mime_type AS "mimeType",
             a.size::text AS size,
             a.status,
             a.message_id AS "messageId",
             a.created_at AS "createdAt"
           FROM attachments a
           LEFT JOIN messages m ON m.id = a.message_id
           WHERE a.uploader_id = $1
             AND a.status IN ('uploaded', 'attached')
             AND (a.message_id IS NULL OR m.deleted_at IS NULL)
           ORDER BY a.created_at DESC
           LIMIT 20`,
          [userId],
        ),
      ]);
    return {
      user,
      friends,
      conversations,
      uploads: {
        fileCount: uploadSummaryRows[0]?.fileCount ?? 0,
        totalBytes: uploadSummaryRows[0]?.totalBytes ?? '0',
        recent: recentUploads,
      },
    };
  }
  async status(
    actor: User,
    userId: string,
    status: 'active' | 'blocked' | 'deleted',
  ) {
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
      if (user.role === 'admin' && status !== 'active')
        throw new HttpException({ code: 'ADMIN_ACCOUNT_PROTECTED' }, 403);
      if (user.status === 'deleted' && status === 'blocked')
        throw new HttpException({ code: 'USER_UNAVAILABLE' }, 409);
      if (status !== 'active')
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
    this.events.accessChanged(
      userId,
      status === 'active' ? 'active' : 'blocked',
    );
    return result;
  }
  async role(actor: User, userId: string, role: 'user' | 'admin') {
    this.admin(actor);
    if (actor.id === userId && role !== 'admin')
      throw new HttpException({ code: 'CANNOT_CHANGE_SELF_ROLE' }, 403);
    return this.db.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new HttpException({ code: 'USER_NOT_FOUND' }, 404);
      if (user.status !== 'active' && role === 'admin')
        throw new HttpException({ code: 'USER_UNAVAILABLE' }, 409);
      const previousRole = user.role;
      await manager.getRepository(User).update(userId, { role });
      await manager.getRepository(AuditLog).insert({
        actorId: actor.id,
        action: 'user.role_updated',
        targetType: 'user',
        targetId: userId,
        metadata: { previousRole, role },
      });
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role,
        status: user.status,
      };
    });
  }
  async deleteContent(
    actor: User,
    targetType: 'message' | 'attachment',
    targetId: string,
  ) {
    this.admin(actor);
    if (targetType !== 'message' && targetType !== 'attachment')
      throw new HttpException({ code: 'INVALID_CONTENT_TARGET' }, 400);
    const tx = await this.db.transaction(async (manager) => {
      let deletedMessage: {
        id: string;
        conversationId: string;
        senderId: string;
        clientMessageId: string;
        sequence: string;
        type: string;
        createdAt: Date;
        editedAt: Date | null;
        deletedAt: Date;
      } | null = null;
      const objectKeysToRemove: string[] = [];
      let metadata: Record<string, unknown>;
      if (targetType === 'message') {
        const rows = await manager.query<
          {
            id: string;
            conversationId: string;
            senderId: string;
            clientMessageId: string;
            sequence: string;
            type: string;
            createdAt: Date;
            editedAt: Date | null;
            deletedAt: Date;
          }[]
        >(
          `UPDATE messages
           SET deleted_at = COALESCE(deleted_at, GREATEST(CURRENT_TIMESTAMP, COALESCE(edited_at, created_at) + INTERVAL '1 millisecond'))
           WHERE id = $1
           RETURNING
             id,
             conversation_id AS "conversationId",
             sender_id AS "senderId",
             client_message_id AS "clientMessageId",
             sequence::text AS sequence,
             type,
             created_at AS "createdAt",
             edited_at AS "editedAt",
             deleted_at AS "deletedAt"`,
          [targetId],
        );
        const msg = rows[0];
        if (!msg) throw new HttpException({ code: 'MESSAGE_NOT_FOUND' }, 404);
        deletedMessage = msg;
        await manager.query('DELETE FROM message_pins WHERE message_id = $1', [
          targetId,
        ]);
        const attached = await manager.query<{ objectKey: string }[]>(
          `SELECT object_key AS "objectKey" FROM attachments WHERE message_id = $1 AND status = 'attached'`,
          [targetId],
        );
        for (const item of attached) objectKeysToRemove.push(item.objectKey);
        metadata = {
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          type: msg.type,
        };
      } else {
        const attRows = await manager.query<
          {
            id: string;
            conversationId: string;
            uploaderId: string;
            messageId: string | null;
            objectKey: string;
            status: string;
            fileName: string;
          }[]
        >(
          `SELECT
             id,
             conversation_id AS "conversationId",
             uploader_id AS "uploaderId",
             message_id AS "messageId",
             object_key AS "objectKey",
             status,
             file_name AS "fileName"
           FROM attachments
           WHERE id = $1
           FOR UPDATE`,
          [targetId],
        );
        const att = attRows[0];
        if (!att)
          throw new HttpException({ code: 'ATTACHMENT_NOT_FOUND' }, 404);
        if (att.messageId) {
          const msgRows = await manager.query<
            {
              id: string;
              conversationId: string;
              senderId: string;
              clientMessageId: string;
              sequence: string;
              type: string;
              createdAt: Date;
              editedAt: Date | null;
              deletedAt: Date;
            }[]
          >(
            `UPDATE messages
             SET deleted_at = COALESCE(deleted_at, GREATEST(CURRENT_TIMESTAMP, COALESCE(edited_at, created_at) + INTERVAL '1 millisecond'))
             WHERE id = $1
             RETURNING
               id,
               conversation_id AS "conversationId",
               sender_id AS "senderId",
               client_message_id AS "clientMessageId",
               sequence::text AS sequence,
               type,
               created_at AS "createdAt",
               edited_at AS "editedAt",
               deleted_at AS "deletedAt"`,
            [att.messageId],
          );
          deletedMessage = msgRows[0] ?? null;
          await manager.query(
            'DELETE FROM message_pins WHERE message_id = $1',
            [att.messageId],
          );
        } else if (att.status === 'pending' || att.status === 'uploaded') {
          await manager.query(
            `UPDATE attachments SET status = 'rejected' WHERE id = $1`,
            [targetId],
          );
        }
        objectKeysToRemove.push(att.objectKey);
        metadata = {
          conversationId: att.conversationId,
          uploaderId: att.uploaderId,
          messageId: att.messageId,
          fileName: att.fileName,
        };
      }
      await manager.query(
        'INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [
          actor.id,
          'content.deleted',
          targetType,
          targetId,
          JSON.stringify(metadata),
        ],
      );
      return { deletedMessage, objectKeysToRemove };
    });
    for (const key of tx.objectKeysToRemove)
      await this.files?.remove(key).catch(() => undefined);
    if (tx.deletedMessage)
      this.events.publish({
        name: 'message:deleted',
        conversationId: tx.deletedMessage.conversationId,
        messageId: tx.deletedMessage.id,
        payload: {
          ...tx.deletedMessage,
          body: null,
          content: null,
          spam: null,
        },
      });
    return { deleted: true, targetType, targetId };
  }
  async auditLogs(actor: User, input: AdminAuditLogsDto) {
    this.admin(actor);
    const repo = this.db.getRepository(AuditLog);
    const query = repo
      .createQueryBuilder('log')
      .addSelect('log.metadata')
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .take(input.limit + 1);
    if (input.actorId)
      query.andWhere('log.actorId = :actorId', { actorId: input.actorId });
    if (input.targetType)
      query.andWhere('log.targetType = :targetType', {
        targetType: input.targetType,
      });
    if (input.targetId)
      query.andWhere('log.targetId = :targetId', { targetId: input.targetId });
    if (input.action)
      query.andWhere('log.action ILIKE :action', {
        action: `%${input.action.replace(/[\\%_]/g, '\\$&')}%`,
      });
    if (input.from)
      query.andWhere('log.createdAt >= :from', { from: new Date(input.from) });
    if (input.to) {
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(input.to)
        ? new Date(`${input.to}T23:59:59.999Z`)
        : new Date(input.to);
      query.andWhere('log.createdAt <= :to', { to: toDate });
    }
    if (input.cursor) {
      if (!(await repo.existsBy({ id: input.cursor })))
        throw new HttpException({ code: 'INVALID_CURSOR' }, 400);
      query.andWhere(
        '(log.createdAt, log.id) < ((SELECT created_at FROM audit_logs WHERE id = :cursor), :cursor)',
        { cursor: input.cursor },
      );
    }
    const rows = await query.getMany();
    const actorIds = [
      ...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id)),
    ];
    const actors = actorIds.length
      ? await this.db.getRepository(User).find({
          where: { id: In(actorIds) },
          select: ['id', 'email', 'displayName'],
        })
      : [];
    const actorMap = new Map(actors.map((u) => [u.id, u]));
    return pageResult(
      rows.map((log) => ({
        id: log.id,
        actorId: log.actorId,
        actor: log.actorId ? (actorMap.get(log.actorId) ?? null) : null,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        requestId: log.requestId,
        metadata: log.metadata ?? {},
        createdAt: log.createdAt,
      })),
      input.limit,
    );
  }
  async exportUserLog(actor: User, userId: string) {
    this.admin(actor);
    const user = await this.db.getRepository(User).findOne({
      where: { id: userId },
      select: [
        'id',
        'email',
        'displayName',
        'role',
        'status',
        'lastActiveAt',
        'createdAt',
        'updatedAt',
      ],
    });
    if (!user) throw new HttpException({ code: 'USER_NOT_FOUND' }, 404);
    const [sessions, friends, conversations, uploads, reports, auditLogs] =
      await Promise.all([
        this.db.query<
          {
            id: string;
            deviceName: string | null;
            createdAt: Date;
            expiresAt: Date;
            revokedAt: Date | null;
          }[]
        >(
          `SELECT id, device_name AS "deviceName", created_at AS "createdAt", expires_at AS "expiresAt", revoked_at AS "revokedAt"
           FROM sessions
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 50`,
          [userId],
        ),
        this.db.query<
          {
            id: string;
            requesterId: string;
            recipientId: string;
            status: string;
            createdAt: Date;
          }[]
        >(
          `SELECT id, requester_id AS "requesterId", recipient_id AS "recipientId", status, created_at AS "createdAt"
           FROM friendships
           WHERE requester_id = $1 OR recipient_id = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [userId],
        ),
        this.db.query<
          {
            conversationId: string;
            type: string;
            title: string | null;
            memberRole: string;
            joinedAt: Date;
            leftAt: Date | null;
          }[]
        >(
          `SELECT
             cmp.conversation_id AS "conversationId",
             c.type,
             c.title,
             COALESCE(cm.role, 'member') AS "memberRole",
             cmp.joined_at AS "joinedAt",
             cmp.left_at AS "leftAt"
           FROM conversation_member_periods cmp
           JOIN conversations c ON c.id = cmp.conversation_id
           LEFT JOIN conversation_members cm ON cm.conversation_id = cmp.conversation_id AND cm.user_id = cmp.user_id
           WHERE cmp.user_id = $1
           ORDER BY cmp.joined_at DESC
           LIMIT 100`,
          [userId],
        ),
        this.db.query<
          {
            id: string;
            conversationId: string;
            fileName: string;
            mimeType: string;
            size: string;
            status: string;
            createdAt: Date;
          }[]
        >(
          `SELECT
             id,
             conversation_id AS "conversationId",
             file_name AS "fileName",
             mime_type AS "mimeType",
             size::text AS size,
             status,
             created_at AS "createdAt"
           FROM attachments
           WHERE uploader_id = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [userId],
        ),
        this.db.query<
          {
            id: string;
            reporterId: string;
            reportedUserId: string | null;
            targetType: string;
            targetId: string;
            reason: string;
            status: string;
            resolution: string | null;
            createdAt: Date;
            reviewedAt: Date | null;
          }[]
        >(
          `SELECT
             id,
             reporter_id AS "reporterId",
             reported_user_id AS "reportedUserId",
             target_type AS "targetType",
             target_id AS "targetId",
             reason,
             status,
             resolution,
             created_at AS "createdAt",
             reviewed_at AS "reviewedAt"
           FROM reports
           WHERE reporter_id = $1 OR reported_user_id = $1 OR (snapshot->>'senderId') = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [userId],
        ),
        this.db.query<
          {
            id: string;
            actorId: string | null;
            action: string;
            targetType: string | null;
            targetId: string | null;
            metadata: Record<string, unknown>;
            createdAt: Date;
          }[]
        >(
          `SELECT
             id,
             actor_id AS "actorId",
             action,
             target_type AS "targetType",
             target_id AS "targetId",
             metadata,
             created_at AS "createdAt"
           FROM audit_logs
           WHERE actor_id = $1 OR (target_type = 'user' AND target_id = $1)
           ORDER BY created_at DESC
           LIMIT 200`,
          [userId],
        ),
      ]);
    await this.db.getRepository(AuditLog).insert({
      actorId: actor.id,
      action: 'compliance.user_export',
      targetType: 'user',
      targetId: userId,
      metadata: {
        sessionsCount: sessions.length,
        auditLogsCount: auditLogs.length,
      },
    });
    return {
      exportedAt: new Date().toISOString(),
      exportedBy: { id: actor.id, email: actor.email },
      user,
      sessions,
      friends,
      conversations,
      uploads,
      reports,
      auditLogs,
    };
  }
  async applyRetention(actor: User, input: RetentionPolicyDto) {
    this.admin(actor);
    const result = await this.db.transaction(async (manager) => {
      let deletedMessages: number;
      let expiredAttachments = 0;
      const objectKeysToRemove: string[] = [];
      if (input.scope === 'attachments' || input.scope === 'both') {
        const unattached = await manager.query<{ objectKey: string }[]>(
          `WITH expired AS (
             UPDATE attachments
             SET status = 'expired'
             WHERE status IN ('pending', 'uploaded')
               AND message_id IS NULL
               AND created_at < CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
             RETURNING object_key AS "objectKey"
           )
           SELECT "objectKey" FROM expired`,
          [input.days],
        );
        for (const row of unattached) objectKeysToRemove.push(row.objectKey);
        expiredAttachments += unattached.length;
      }
      if (input.scope === 'messages' || input.scope === 'both') {
        const deletedRows = await manager.query<{ id: string; type: string }[]>(
          `WITH updated AS (
             UPDATE messages
             SET deleted_at = GREATEST(CURRENT_TIMESTAMP, created_at)
             WHERE deleted_at IS NULL
               AND created_at < CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
             RETURNING id, type
           )
           SELECT id, type FROM updated`,
          [input.days],
        );
        deletedMessages = deletedRows.length;
        if (deletedRows.length) {
          await manager.query(
            `DELETE FROM message_pins WHERE message_id = ANY($1::uuid[])`,
            [deletedRows.map((r) => r.id)],
          );
        }
        if (input.scope === 'both' && deletedRows.length) {
          const mediaIds = deletedRows
            .filter((r) => ['image', 'file', 'voice'].includes(r.type))
            .map((r) => r.id);
          if (mediaIds.length) {
            const attached = await manager.query<{ objectKey: string }[]>(
              `SELECT object_key AS "objectKey"
               FROM attachments
               WHERE status = 'attached' AND message_id = ANY($1::uuid[])`,
              [mediaIds],
            );
            for (const row of attached) objectKeysToRemove.push(row.objectKey);
            expiredAttachments += attached.length;
          }
        }
      } else {
        const mediaRows = await manager.query<
          {
            messageId: string;
            objectKey: string;
          }[]
        >(
          `WITH target AS (
             SELECT m.id AS message_id, a.object_key AS "objectKey"
             FROM messages m
             JOIN attachments a ON a.message_id = m.id
             WHERE a.status = 'attached'
               AND m.deleted_at IS NULL
               AND m.type IN ('image', 'file', 'voice')
               AND a.created_at < CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
           ),
           updated AS (
             UPDATE messages m
             SET deleted_at = GREATEST(CURRENT_TIMESTAMP, m.created_at)
             FROM target t
             WHERE m.id = t.message_id AND m.deleted_at IS NULL
             RETURNING m.id
           )
           SELECT DISTINCT t.message_id AS "messageId", t."objectKey"
           FROM target t
           JOIN updated u ON u.id = t.message_id`,
          [input.days],
        );
        const deletedMediaMessageIds = [
          ...new Set(mediaRows.map((row) => row.messageId)),
        ];
        deletedMessages = deletedMediaMessageIds.length;
        if (deletedMediaMessageIds.length) {
          await manager.query(
            `DELETE FROM message_pins WHERE message_id = ANY($1::uuid[])`,
            [deletedMediaMessageIds],
          );
        }
        for (const row of mediaRows) objectKeysToRemove.push(row.objectKey);
        expiredAttachments += mediaRows.length;
      }
      await manager.getRepository(AuditLog).insert({
        actorId: actor.id,
        action: 'compliance.retention',
        targetType: null,
        targetId: null,
        metadata: {
          days: input.days,
          scope: input.scope,
          deletedMessages,
          expiredAttachments,
        },
      });
      return {
        days: input.days,
        scope: input.scope,
        deletedMessages,
        expiredAttachments,
        executedAt: new Date().toISOString(),
        objectKeysToRemove,
      };
    });
    for (const key of result.objectKeysToRemove)
      await this.files?.remove(key).catch(() => undefined);
    return {
      days: result.days,
      scope: result.scope,
      deletedMessages: result.deletedMessages,
      expiredAttachments: result.expiredAttachments,
      executedAt: result.executedAt,
    };
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
