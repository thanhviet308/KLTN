const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { ReportsService } = require('../dist/modules/reports/reports.service');
const {
  CreateReportDto,
  ReviewReportDto,
} = require('../dist/modules/reports/reports.dto');
const { Report } = require('../dist/modules/database/entities/report.entity');
const { User } = require('../dist/modules/database/entities/user.entity');
const { Message } = require('../dist/modules/database/entities/message.entity');
const {
  Attachment,
} = require('../dist/modules/database/entities/attachment.entity');
const { Call } = require('../dist/modules/database/entities/call.entity');
const {
  CallParticipant,
} = require('../dist/modules/database/entities/call-participant.entity');
const {
  Notification,
} = require('../dist/modules/database/entities/notification.entity');
const admin = { id: 'admin', role: 'admin' };
const code = (expected) => (error) => error.getResponse().code === expected;

test('admin image access is limited to the reported attachment or message', async () => {
  for (const target of [
    { reportedAttachmentId: 'image', reportedMessageId: null },
    { reportedAttachmentId: null, reportedMessageId: 'message' },
  ]) {
    const seen = {};
    const builder = {
      addSelect: () => builder,
      where: (sql, args) => {
        seen.sql = sql;
        seen.id = args.id;
        return builder;
      },
      andWhere: (sql) => {
        seen.filter = sql;
        return builder;
      },
      getOne: async () => ({ id: 'image', objectKey: 'server-owned-key' }),
    };
    const service = new ReportsService(
      {
        getRepository: (entity) =>
          entity === Report
            ? {
                findOneBy: async ({ id }) => {
                  assert.equal(id, 'report');
                  return target;
                },
              }
            : { createQueryBuilder: () => builder },
      },
      {},
    );
    assert.equal(
      (await service.image(admin, 'report')).objectKey,
      'server-owned-key',
    );
    assert.equal(
      seen.id,
      target.reportedAttachmentId ?? target.reportedMessageId,
    );
    assert.match(seen.filter, /image\/webp/);
    assert.match(seen.filter, /status = 'attached'/);
  }
});

test('admin queue includes evidence, pending count and stable pagination', async () => {
  const seen = {};
  const builder = {
    getMany: async () => [
      { id: 'new', snapshot: { body: 'evidence' } },
      { id: 'old' },
    ],
  };
  for (const name of ['addSelect', 'orderBy', 'addOrderBy', 'take', 'where'])
    builder[name] = (...args) => {
      seen[name] = args;
      return builder;
    };
  const service = new ReportsService(
    {
      getRepository: () => ({
        createQueryBuilder: () => builder,
        countBy: async () => 2,
        existsBy: async () => true,
      }),
    },
    {},
  );
  const result = await service.queue(admin, { limit: 1, cursor: 'cursor' });
  assert.equal(result.pendingCount, 2);
  assert.equal(result.nextCursor, 'new');
  assert.equal(result.items[0].snapshot.body, 'evidence');
  assert.deepEqual(seen.addSelect, ['report.snapshot']);
  assert.deepEqual(seen.orderBy, ['report.createdAt', 'DESC']);
  assert.equal(seen.where[1].cursor, 'cursor');
});

function fixture() {
  const state = {
    existing: null,
    count: 0,
    saves: [],
    notifications: [],
    visible: true,
    access: true,
    participant: true,
    queries: [],
    row: null,
  };
  const message = {
    id: 'message',
    conversationId: 'room',
    senderId: 'peer',
    type: 'text',
    body: 'Original',
    editedBody: 'Edited evidence',
    content: null,
    createdAt: new Date(),
  };
  const reportRepository = {
    findOneBy: async () => state.existing,
    countBy: async () => state.count,
    create: (value) => value,
    save: async (value) => {
      const row = { id: 'report', ...value };
      state.saves.push(row);
      return row;
    },
    findOne: async () => state.row,
  };
  const manager = {
    query: async (sql) => state.queries.push(sql),
    getRepository: (entity) => {
      if (entity === Report) return reportRepository;
      if (entity === User)
        return { findOneBy: async () => ({ id: 'peer', displayName: 'Peer' }) };
      if (entity === Message) {
        const builder = {
          where: (sql) => {
            state.queries.push(sql);
            return builder;
          },
          andWhere: (sql) => {
            state.queries.push(sql);
            return builder;
          },
          getOne: async () => (state.visible ? message : null),
        };
        return { createQueryBuilder: () => builder };
      }
      if (entity === Attachment)
        return {
          findOneBy: async () => ({
            id: 'image',
            messageId: 'message',
            status: 'attached',
            mimeType: 'image/webp',
            fileName: 'photo.webp',
            size: '123',
          }),
        };
      if (entity === CallParticipant)
        return {
          findOneBy: async (criteria) => {
            assert.equal(criteria.userId, 'reporter');
            return state.participant ? {} : null;
          },
        };
      if (entity === Call)
        return {
          findOneBy: async () => ({
            id: 'call',
            conversationId: 'room',
            initiatorId: 'peer',
            type: 'video',
            status: 'ended',
            createdAt: new Date(),
          }),
        };
      if (entity === Notification) {
        const builder = {
          insert: () => builder,
          values: (value) => {
            state.notifications.push(value);
            return builder;
          },
          orIgnore: () => builder,
          execute: async () => {},
        };
        return { createQueryBuilder: () => builder };
      }
      throw new Error('Unexpected repository');
    },
  };
  const db = {
    transaction: (work) => work(manager),
    getRepository: manager.getRepository,
  };
  const service = new ReportsService(db, {
    requireAccess: async () => {
      if (!state.access) throw new Error('No membership');
    },
  });
  return { state, service };
}

test('report DTOs reject empty reasons, forged types, malformed IDs and invalid review states', async () => {
  const valid = {
    targetType: 'user',
    targetId: '10000000-0000-4000-8000-000000000001',
    reason: '  Spam  ',
  };
  const dto = plainToInstance(CreateReportDto, valid);
  assert.equal((await validate(dto)).length, 0);
  assert.equal(dto.reason, 'Spam');
  for (const change of [
    { reason: '  ' },
    { reason: 'x'.repeat(2001) },
    { targetId: 'bad' },
    { targetType: 'conversation' },
  ])
    assert.ok(
      (
        await validate(
          plainToInstance(CreateReportDto, { ...valid, ...change }),
        )
      ).length,
    );
  assert.ok(
    (
      await validate(
        plainToInstance(ReviewReportDto, { status: 'open', resolution: ' ' }),
      )
    ).length,
  );
});
test('all four report types select exactly one target field and use canonical evidence', async () => {
  for (const [targetType, field] of Object.entries({
    user: 'reportedUserId',
    message: 'reportedMessageId',
    call: 'reportedCallId',
    attachment: 'reportedAttachmentId',
  })) {
    const { service, state } = fixture();
    await service.create('reporter', {
      targetType,
      targetId: 'target',
      reason: 'Spam',
    });
    const row = state.saves[0];
    assert.equal(row[field], 'target');
    assert.equal(
      Object.keys(row).filter((key) => key.startsWith('reported')).length,
      1,
    );
    assert.equal(row.reporterId, 'reporter');
    assert.equal(row.status, 'open');
    if (targetType === 'message')
      assert.equal(row.snapshot.body, 'Edited evidence');
    if (targetType === 'attachment')
      assert.equal(row.snapshot.fileName, 'photo.webp');
  }
});
test('duplicate reports return the existing queue item and quota blocks new reports', async () => {
  const { service, state } = fixture();
  state.existing = { id: 'existing', status: 'reviewing' };
  assert.equal(
    (
      await service.create('reporter', {
        targetType: 'user',
        targetId: 'peer',
        reason: 'Spam',
      })
    ).duplicate,
    true,
  );
  assert.equal(state.saves.length, 0);
  state.existing = null;
  state.count = 20;
  await assert.rejects(
    service.create('reporter', {
      targetType: 'user',
      targetId: 'peer',
      reason: 'Spam',
    }),
    code('REPORT_RATE_LIMIT'),
  );
});
test('reports reject self-reporting, inaccessible messages/images, and calls without participation', async () => {
  const { service, state } = fixture();
  await assert.rejects(
    service.create('reporter', {
      targetType: 'user',
      targetId: 'reporter',
      reason: 'Spam',
    }),
    code('REPORT_SELF'),
  );
  state.visible = false;
  for (const targetType of ['message', 'attachment'])
    await assert.rejects(
      service.create('reporter', {
        targetType,
        targetId: 'private',
        reason: 'Spam',
      }),
      code('REPORT_TARGET_UNAVAILABLE'),
    );
  assert.ok(
    state.queries.some(
      (sql) =>
        sql.includes('joined_after_sequence') &&
        sql.includes('left_after_sequence'),
    ),
  );
  state.visible = true;
  state.access = false;
  await assert.rejects(
    service.create('reporter', {
      targetType: 'message',
      targetId: 'message',
      reason: 'Spam',
    }),
    /No membership/,
  );
  state.participant = false;
  await assert.rejects(
    service.create('reporter', {
      targetType: 'call',
      targetId: 'private',
      reason: 'Spam',
    }),
    code('REPORT_TARGET_UNAVAILABLE'),
  );
  assert.equal(state.saves.length, 0);
});
test('queue, evidence and review reject non-admins before accessing data', async () => {
  const { service } = fixture();
  const user = { id: 'reporter', role: 'user' };
  await assert.rejects(
    service.queue(user, { limit: 20 }),
    code('ADMIN_REQUIRED'),
  );
  await assert.rejects(service.image(user, 'report'), code('ADMIN_REQUIRED'));
  await assert.rejects(
    service.review(user, 'report', {}),
    code('ADMIN_REQUIRED'),
  );
});
test('review enforces ownership and terminal states; resolution notifies the reporter once', async () => {
  const { service, state } = fixture();
  state.row = {
    id: 'report',
    reporterId: 'reporter',
    status: 'open',
    reviewerId: null,
    createdAt: new Date(),
  };
  await assert.rejects(
    service.review({ id: 'reporter', role: 'admin' }, 'report', {
      status: 'resolved',
      resolution: 'Done',
    }),
    code('REPORT_SELF_REVIEW'),
  );
  await service.review(admin, 'report', {
    status: 'reviewing',
    resolution: 'Reviewing',
  });
  assert.equal(state.row.resolution, null);
  assert.equal(state.row.reviewedAt, null);
  assert.equal(state.notifications.length, 0);
  await assert.rejects(
    service.review({ id: 'another', role: 'admin' }, 'report', {
      status: 'resolved',
      resolution: 'Done',
    }),
    code('REPORT_ASSIGNED'),
  );
  await service.review(admin, 'report', {
    status: 'resolved',
    resolution: 'Confirmed violation',
  });
  assert.equal(state.row.resolution, 'Confirmed violation');
  assert.ok(state.row.reviewedAt >= state.row.createdAt);
  assert.equal(state.notifications[0].userId, 'reporter');
  assert.equal(state.notifications[0].type, 'report_updated');
  await assert.rejects(
    service.review(admin, 'report', {
      status: 'dismissed',
      resolution: 'Again',
    }),
    code('REPORT_CLOSED'),
  );
  assert.equal(state.notifications.length, 1);
  assert.ok(
    state.queries.some((sql) => sql.includes('INSERT INTO audit_logs')),
  );
});

const {
  AccountsService,
} = require('../dist/modules/workspace/accounts.service');
const {
  AccountRoleDto,
  AccountStatusDto,
  AdminAuditLogsDto,
  AdminDashboardDto,
  AdminUsersDto,
  RetentionPolicyDto,
} = require('../dist/modules/workspace/workspace.dto');

test('admin workspace DTOs validate dashboard, filters, roles, audit logs and retention inputs', async () => {
  assert.equal(
    (await validate(plainToInstance(AdminDashboardDto, { days: '14' }))).length,
    0,
  );
  assert.ok(
    (await validate(plainToInstance(AdminDashboardDto, { days: 0 }))).length,
  );
  assert.equal(
    (
      await validate(
        plainToInstance(AdminUsersDto, {
          query: 'minh',
          status: 'deleted',
          role: 'admin',
        }),
      )
    ).length,
    0,
  );
  assert.equal(
    (await validate(plainToInstance(AccountStatusDto, { status: 'deleted' })))
      .length,
    0,
  );
  assert.equal(
    (await validate(plainToInstance(AccountRoleDto, { role: 'admin' }))).length,
    0,
  );
  assert.ok(
    (await validate(plainToInstance(AccountRoleDto, { role: 'superadmin' })))
      .length,
  );
  assert.equal(
    (
      await validate(
        plainToInstance(AdminAuditLogsDto, {
          actorId: '10000000-0000-4000-8000-000000000001',
          targetType: 'user',
          action: 'user.blocked',
          from: '2026-11-01',
          to: '2026-11-14',
        }),
      )
    ).length,
    0,
  );
  assert.ok(
    (
      await validate(
        plainToInstance(RetentionPolicyDto, { days: 0, scope: 'both' }),
      )
    ).length,
  );
  assert.equal(
    (
      await validate(
        plainToInstance(RetentionPolicyDto, { days: 90, scope: 'both' }),
      )
    ).length,
    0,
  );
});

test('accounts admin methods enforce admin role, self-protection and compliance auditing', async () => {
  const events = { accessChanged() {}, publish() {} };
  const queries = [];
  const audits = [];
  const targetUser = {
    id: '10000000-0000-4000-8000-000000000002',
    email: 'user@example.com',
    displayName: 'User',
    role: 'user',
    status: 'active',
    lastActiveAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const manager = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('UPDATE messages') && sql.includes('RETURNING')) {
        return [
          {
            id: '10000000-0000-4000-8000-000000000099',
            conversationId: 'conv-1',
            senderId: targetUser.id,
            clientMessageId: 'cli-1',
            sequence: '1',
            type: 'text',
            createdAt: new Date(),
            editedAt: null,
            deletedAt: new Date(),
          },
        ];
      }
      return [];
    },
    getRepository: (entity) => {
      if (entity === User)
        return {
          findOne: async () => ({ ...targetUser }),
          update: async () => ({}),
        };
      return {
        insert: async (row) => {
          audits.push(row);
          return {};
        },
      };
    },
  };
  const db = {
    query: async (sql) => {
      if (sql.includes('FROM users'))
        return [{ total: 10, active: 8, blocked: 1, deleted: 1, admins: 2 }];
      if (sql.includes('messagesToday'))
        return [
          {
            messagesToday: 42,
            messagesPeriod: 300,
            callsPeriod: 12,
            gamesPeriod: 9,
            groupsTotal: 5,
            pendingReports: 3,
            uploadFilesTotal: 7,
            uploadBytesTotal: '2048',
          },
        ];
      return [
        { date: '2026-11-14', newUsers: 2, messages: 42, calls: 4, games: 3 },
      ];
    },
    getRepository: manager.getRepository,
    transaction: (work) => work(manager),
  };
  const filesRemoved = [];
  const service = new AccountsService(db, events, {
    remove: async (k) => filesRemoved.push(k),
  });
  const nonAdmin = { id: 'user-1', role: 'user' };
  const adminUser = {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'admin@example.com',
    role: 'admin',
  };

  await assert.rejects(
    service.dashboard(nonAdmin, { days: 14 }),
    code('ADMIN_REQUIRED'),
  );
  await assert.rejects(
    service.role(adminUser, adminUser.id, 'user'),
    code('CANNOT_CHANGE_SELF_ROLE'),
  );
  await assert.rejects(
    service.applyRetention(nonAdmin, { days: 30, scope: 'both' }),
    code('ADMIN_REQUIRED'),
  );

  const dash = await service.dashboard(adminUser, { days: 7 });
  assert.equal(dash.days, 7);
  assert.equal(dash.users.active, 8);
  assert.equal(dash.totals.callsPeriod, 12);

  const promoted = await service.role(adminUser, targetUser.id, 'admin');
  assert.equal(promoted.role, 'admin');
  assert.equal(audits[0].action, 'user.role_updated');

  await service.deleteContent(
    adminUser,
    'message',
    '10000000-0000-4000-8000-000000000099',
  );
  assert.ok(queries.some((q) => q.sql.includes('INSERT INTO audit_logs')));

  const retention = await service.applyRetention(adminUser, {
    days: 90,
    scope: 'both',
  });
  assert.equal(retention.days, 90);
  assert.equal(retention.deletedMessages, 1);
  assert.equal(audits.at(-1).action, 'compliance.retention');
});
