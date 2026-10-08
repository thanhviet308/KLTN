const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');

process.loadEnvFile('apps/api/.env');
assert.ok(
  ['localhost', '127.0.0.1'].includes(
    new URL(process.env.DATABASE_URL).hostname,
  ),
  'Integration test is local-only',
);
const { AppModule } = require('../dist/app.module');
const { configureApp } = require('../dist/configure-app');
const { User } = require('../dist/modules/database/entities/user.entity');
const { Session } = require('../dist/modules/database/entities/session.entity');
const {
  Friendship,
} = require('../dist/modules/database/entities/friendship.entity');
const {
  ConversationsService,
} = require('../dist/modules/conversations/conversations.service');

(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pingpong-media-'));
  process.env.CHAT_FILES_DIR = directory;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  let app, db, conversationId;
  try {
    app = await NestFactory.create(AppModule, {
      logger: false,
      bodyParser: false,
      abortOnError: false,
    });
    configureApp(app, {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 0,
      WEB_ORIGIN: 'http://localhost:5173',
      TRUST_PROXY: false,
    });
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    await db.getRepository(User).insert(
      ids.map((id) => ({
        id,
        email: `${id}@example.test`,
        displayName: 'Media integration',
        passwordHash: 'not-a-login-password',
      })),
    );
    await db
      .getRepository(Friendship)
      .insert({ requesterId: ids[0], recipientId: ids[1], status: 'accepted' });
    conversationId = (
      await app
        .get(ConversationsService)
        .create(ids[0], { type: 'direct', recipientId: ids[1] })
    ).conversation.id;
    const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
    const tokens = [];
    for (const id of ids) {
      const session = await db
        .getRepository(Session)
        .save({ userId: id, expiresAt: new Date(Date.now() + 3600000) });
      tokens.push(
        await jwt.signAsync(
          { sid: session.id, type: 'access' },
          {
            algorithm: 'HS256',
            subject: id,
            issuer: 'realtime-chat-api',
            audience: 'realtime-chat-client',
            expiresIn: 600,
          },
        ),
      );
    }
    const base = `${await app.getUrl()}/api/v1/conversations/${conversationId}/messages`;
    const call = async (suffix, actor = 0, init = {}) => {
      const response = await fetch(`${base}${suffix}`, {
        ...init,
        headers: { Authorization: `Bearer ${tokens[actor]}`, ...init.headers },
      });
      return response;
    };
    const post = (body) =>
      call('', 0, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const location = {
      clientMessageId: randomUUID(),
      type: 'location',
      location: { latitude: 10.7769, longitude: 106.7009 },
    };
    let response = await post(location);
    assert.equal(response.status, 200);
    const located = (await response.json()).message;
    assert.deepEqual(located.content, location.location);
    assert.equal((await (await post(location)).json()).message.id, located.id);
    assert.equal(
      (await post({ ...location, location: { latitude: 91, longitude: 0 } }))
        .status,
      400,
    );
    assert.equal(
      (await post({ clientMessageId: randomUUID(), type: 'location' })).status,
      400,
    );
    assert.equal(
      (
        await post({
          ...location,
          clientMessageId: randomUUID(),
          location: { latitude: 1, longitude: 1, injected: true },
        })
      ).status,
      400,
    );
    const upload = (
      bytes,
      type = 'file',
      key = randomUUID(),
      actor = 0,
      mimeType = 'text/plain',
      fileName = 'test.txt',
    ) => {
      const query = new URLSearchParams({
        type,
        clientMessageId: key,
        mimeType,
        fileName,
      });
      return call(`/upload?${query}`, actor, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      });
    };
    const key = randomUUID();
    const bytes = Buffer.from('private attachment');
    const pair = await Promise.all([
      upload(bytes, 'file', key),
      upload(bytes, 'file', key),
    ]);
    assert.deepEqual(
      pair.map((item) => item.status),
      [200, 200],
    );
    const sent = (await pair[0].json()).message;
    assert.equal((await pair[1].json()).message.id, sent.id);
    assert.equal((await readdir(directory)).length, 1, 'Retry file is removed');
    assert.equal(
      (await upload(Buffer.from('different'), 'file', key)).status,
      409,
    );
    assert.equal((await upload(bytes, 'file', randomUUID(), 2)).status, 404);
    response = await call(`/${sent.id}/file`, 1);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'application/octet-stream',
    );
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal((await call(`/${sent.id}/file`, 2)).status, 404);
    assert.equal((await fetch(`${base}/${sent.id}/file`)).status, 401);
    assert.equal(
      (
        await upload(
          bytes,
          'file',
          randomUUID(),
          0,
          'text/plain',
          '../escape.txt',
        )
      ).status,
      400,
    );
    assert.equal(
      (await upload(bytes, 'image', randomUUID(), 0, 'image/png', 'fake.png'))
        .status,
      400,
    );
    assert.equal(
      (await upload(bytes, 'voice', randomUUID(), 0, 'audio/webm', 'fake.webm'))
        .status,
      400,
    );
    assert.equal(
      (await upload(Buffer.alloc(10 * 1024 * 1024 + 1))).status,
      413,
    );
    const image = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#448877' },
    })
      .png()
      .toBuffer();
    const imageKey = randomUUID();
    response = await upload(
      image,
      'image',
      imageKey,
      0,
      'image/png',
      'photo.png',
    );
    assert.equal(response.status, 200);
    const picture = (await response.json()).message;
    assert.equal(picture.content.mimeType, 'image/webp');
    assert.equal(
      (
        await (
          await upload(image, 'image', imageKey, 0, 'image/png', 'photo.png')
        ).json()
      ).message.id,
      picture.id,
    );
    const downloaded = Buffer.from(
      await (await call(`/${picture.id}/file`, 1)).arrayBuffer(),
    );
    assert.equal((await sharp(downloaded).metadata()).format, 'webp');
    // Fixture tests accepted recorder container identification (not codec playback).
    const ogg = Buffer.concat([
      Buffer.from('OggS'),
      Buffer.alloc(24),
      Buffer.from('OpusHead'),
      Buffer.alloc(20),
    ]);
    response = await upload(
      ogg,
      'voice',
      randomUUID(),
      0,
      'audio/ogg;codecs=opus',
      'voice.ogg',
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message.type, 'voice');
    response = await call(`/${sent.id}`, 0, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal((await call(`/${sent.id}/file`, 1)).status, 404);
    const history = await (await call('?limit=50', 1)).json();
    assert.ok(
      history.items.some(
        (item) => item.id === located.id && item.type === 'location',
      ),
    );
    assert.ok(
      history.items.some(
        (item) =>
          item.id === sent.id && item.deletedAt && item.content === null,
      ),
    );
    console.log(
      'Chat media HTTP integration passed: validation, private downloads, image normalization, voice container, retry/concurrency, retraction, history',
    );
  } finally {
    if (db?.isInitialized)
      await db.transaction(async (manager) => {
        if (conversationId) {
          await manager.query(
            'UPDATE conversation_members SET last_read_sequence = NULL WHERE conversation_id = $1',
            [conversationId],
          );
          for (const table of [
            'message_reactions',
            'message_receipts',
            'attachments',
            'messages',
            'conversation_member_periods',
            'conversation_members',
          ])
            await manager.query(
              `DELETE FROM ${table} WHERE conversation_id = $1`,
              [conversationId],
            );
          await manager.query('DELETE FROM conversations WHERE id = $1', [
            conversationId,
          ]);
        }
        await manager.query(
          'DELETE FROM friendships WHERE requester_id = ANY($1::uuid[])',
          [ids],
        );
        await manager.query(
          'DELETE FROM sessions WHERE user_id = ANY($1::uuid[])',
          [ids],
        );
        await manager.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          ids,
        ]);
      });
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
