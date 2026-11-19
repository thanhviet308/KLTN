import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDashboardCsvContent,
  buildFormalReportHtml,
  computeChartAxisTicks,
  computeGrowthBadge,
  escapeCsvCell,
  formatDurationSeconds,
} from '../src/features/admin/admin-report-builder.ts';

const sampleDashboard = {
  days: 7,
  users: {
    total: 25,
    active: 22,
    blocked: 2,
    deleted: 1,
    admins: 2,
    active24h: 9,
    active7d: 18,
    newPeriod: 6,
    newPreviousPeriod: 4,
  },
  totals: {
    messagesToday: 40,
    messagesPeriod: 320,
    messagesPreviousPeriod: 200,
    callsPeriod: 15,
    callsPreviousPeriod: 15,
    gamesPeriod: 8,
    gamesPreviousPeriod: 10,
    groupsTotal: 5,
    directConversationsTotal: 19,
    pendingReports: 2,
    spamDetectedPeriod: 3,
    recalledMessagesPeriod: 5,
    uploadFilesTotal: 14,
    uploadBytesTotal: String(5 * 1024 * 1024),
  },
  series: [
    { date: '2026-11-12', newUsers: 1, messages: 50, calls: 2, games: 1 },
    { date: '2026-11-13', newUsers: 2, messages: 70, calls: 3, games: 2 },
    { date: '2026-11-14', newUsers: 3, messages: 200, calls: 10, games: 5 },
  ],
  breakdown: {
    messageTypes: {
      text: 250,
      image: 40,
      file: 12,
      voice: 8,
      location: 4,
      call: 6,
    },
    calls: {
      audio: 9,
      video: 6,
      completed: 12,
      missedOrRejected: 3,
      totalDurationSeconds: 3720,
      aiSummaries: 4,
    },
    aiJobs: {
      total: 22,
      completed: 21,
      chat: 10,
      summary: 6,
      replySuggestions: 6,
    },
    reports: {
      total: 10,
      open: 1,
      reviewing: 1,
      resolved: 6,
      dismissed: 2,
      byTarget: {
        user: 2,
        message: 5,
        attachment: 2,
        call: 1,
        conversation: 0,
      },
    },
  },
};

test('computeChartAxisTicks avoids duplicate Y-axis ticks even for 0 or 1 max values', () => {
  assert.deepEqual(computeChartAxisTicks(0), [3, 2, 1, 0]);
  assert.deepEqual(computeChartAxisTicks(1), [3, 2, 1, 0]);
  assert.deepEqual(computeChartAxisTicks(10), [12, 8, 4, 0]);
});

test('computeGrowthBadge formats positive, negative, flat and zero-baseline deltas', () => {
  assert.deepEqual(computeGrowthBadge(0, 0), {
    label: 'Ổn định',
    tone: 'neutral',
    direction: 'flat',
  });
  assert.equal(computeGrowthBadge(5, 0).direction, 'up');
  assert.equal(computeGrowthBadge(150, 100).direction, 'up');
  assert.equal(computeGrowthBadge(150, 100).tone, 'positive');
  assert.equal(computeGrowthBadge(80, 100).direction, 'down');
  assert.equal(computeGrowthBadge(80, 100).tone, 'warning');
  assert.equal(computeGrowthBadge(15, 15).direction, 'flat');
});

test('formatDurationSeconds formats hours, minutes and seconds cleanly in Vietnamese', () => {
  assert.equal(formatDurationSeconds(0), '0 phút');
  assert.equal(formatDurationSeconds(45), '45 giây');
  assert.equal(formatDurationSeconds(120), '2 phút');
  assert.equal(formatDurationSeconds(3720), '1g 02p');
});

test('buildDashboardCsvContent generates UTF-8 BOM CSV with KPIs, breakdowns and daily totals', () => {
  const csv = buildDashboardCsvContent(sampleDashboard, {
    displayName: 'Admin Viet',
    email: 'admin@pingpong.id.vn',
  });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('BÁO CÁO THỐNG KÊ VẬN HÀNH HỆ THỐNG PINGPONG'));
  assert.ok(csv.includes('TỔNG CỘNG TRONG KỲ'));
  assert.ok(csv.includes('TRUNG BÌNH / NGÀY'));
  assert.ok(csv.includes('5.00 MB'));
});

test('escapeCsvCell neutralizes Excel formula injection while keeping numeric deltas intact', () => {
  assert.equal(
    escapeCsvCell('=HYPERLINK("http://evil")'),
    '"\'=HYPERLINK(""http://evil"")"',
  );
  assert.equal(escapeCsvCell('+CMD|/C calc'), '"\'+CMD|/C calc"');
  assert.equal(escapeCsvCell('+12,8%'), '"+12,8%"');
  assert.equal(escapeCsvCell('-5%'), '"-5%"');
});

test('buildFormalReportHtml escapes untrusted admin names and includes printable sections', () => {
  const html = buildFormalReportHtml(sampleDashboard, {
    displayName: 'Admin <script>alert(1)</script>',
    email: 'admin@example.com',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Báo Cáo Thống Kê Vận Hành'));
  assert.ok(html.includes('2026-11-14'));
});
