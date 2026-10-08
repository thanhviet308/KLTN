const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DataSource } = require('typeorm');
const { JwtService } = require('@nestjs/jwt');
const sharp = require('sharp');
const { typeormOptions } = require('../dist/modules/database/typeorm-options');
const { User } = require('../dist/modules/database/entities/user.entity');
const { Session } = require('../dist/modules/database/entities/session.entity');
const { UsersService } = require('../dist/modules/users/users.service');
const { PasswordService } = require('../dist/modules/auth/password.service');
const { AuthService } = require('../dist/modules/auth/auth.service');

// Explicit local-only integration check; never run this against the VPS/cloud.
process.loadEnvFile('apps/api/.env');
assert.ok(
  ['localhost', '127.0.0.1'].includes(
    new URL(process.env.DATABASE_URL).hostname,
  ),
);
const db = new DataSource(typeormOptions(process.env.DATABASE_URL));
const id = randomUUID();
(async () => {
  try {
    await db.initialize();
    const passwords = new PasswordService();
    await passwords.onModuleInit();
    const users = new UsersService(db.getRepository(User));
    const auth = new AuthService(
      db,
      passwords,
      new JwtService(),
      users,
      undefined,
    );
    await db.getRepository(User).insert({
      id,
      email: `${id}@example.test`,
      displayName: 'Profile test',
      passwordHash: await passwords.hash('old-test-password'),
    });
    await db
      .getRepository(Session)
      .insert({ userId: id, expiresAt: new Date(Date.now() + 86400000) });
    await assert.rejects(
      auth.changePassword(id, {
        currentPassword: 'wrong',
        newPassword: 'new-test-password',
        confirmPassword: 'new-test-password',
      }),
      (error) => error.getResponse().code === 'CURRENT_PASSWORD_INVALID',
    );
    assert.equal(
      (await db.getRepository(Session).findOneByOrFail({ userId: id }))
        .revokedAt,
      null,
    );
    await auth.changePassword(id, {
      currentPassword: 'old-test-password',
      newPassword: 'new-test-password',
      confirmPassword: 'new-test-password',
    });
    assert.ok(
      (await db.getRepository(Session).findOneByOrFail({ userId: id }))
        .revokedAt,
    );
    const changed = await db
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOneOrFail();
    assert.equal(
      await passwords.verify('old-test-password', changed.passwordHash),
      false,
    );
    assert.equal(
      await passwords.verify('new-test-password', changed.passwordHash),
      true,
    );
    await assert.rejects(
      users.updateAvatar(
        id,
        'data:image/png;base64,' + Buffer.from('fake-image').toString('base64'),
      ),
      (error) => error.getResponse().code === 'AVATAR_INVALID',
    );
    const image = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#145650' },
    })
      .png()
      .toBuffer();
    const first = await users.updateAvatar(
      id,
      `data:image/png;base64,${image.toString('base64')}`,
    );
    const version = first.user.avatarUrl.split('/').at(-1);
    const metadata = await sharp(await users.avatar(version)).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
    const second = await users.updateAvatar(
      id,
      `data:image/png;base64,${image.toString('base64')}`,
    );
    assert.notEqual(second.user.avatarUrl, first.user.avatarUrl);
    await assert.rejects(users.avatar(version));
    assert.equal((await users.updateAvatar(id, null)).user.avatarUrl, null);
    console.log(
      'Password verification/session revocation and avatar validation/resize/replace/remove passed.',
    );
  } finally {
    if (db.isInitialized) {
      await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await db.query('DELETE FROM users WHERE id=$1', [id]);
      await db.destroy();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
