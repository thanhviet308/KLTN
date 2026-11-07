import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
import { PasswordReset } from '../database/entities/password-reset.entity';
import { User } from '../database/entities/user.entity';
import { Session } from '../database/entities/session.entity';
import { PasswordService } from './password.service';
import { VerificationMailService } from './verification-mail.service';
import { authError } from './auth-error';
import type { ResetPasswordDto } from './auth.dto';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(VerificationMailService)
    private readonly mail: VerificationMailService,
  ) {}

  private codeHash(challengeId: string, code: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    )
      .update(`password-reset:${challengeId}:${code}`)
      .digest('hex');
  }

  private credentialHash(passwordHash: string) {
    return createHash('sha256').update(passwordHash).digest('hex');
  }

  async requestCode(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    this.mail.assertConfigured();
    const challengeId = randomUUID();
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60000);
    const eligible = await this.db.transaction(async (manager) => {
      const repository = manager.getRepository(PasswordReset);
      // Store the same challenge and limits even for unknown/inactive emails.
      await repository
        .createQueryBuilder()
        .insert()
        .values({
          email,
          challengeId,
          codeHash: this.codeHash(challengeId, code),
          attempts: 0,
          sendCount: 1,
          windowStartedAt: now,
          sentAt: now,
          expiresAt,
        })
        .orIgnore()
        .execute();
      const current = await repository.findOneOrFail({
        where: { email },
        lock: { mode: 'pessimistic_write' },
      });
      const first = current.challengeId === challengeId;
      const resetWindow =
        now.getTime() - current.windowStartedAt.getTime() >= 60 * 60000;
      if (!first && now.getTime() - current.sentAt.getTime() < 60000)
        throw authError(
          429,
          'VERIFICATION_COOLDOWN',
          'Wait before requesting another code',
        );
      if (!first && !resetWindow && current.sendCount >= 5)
        throw authError(
          429,
          'VERIFICATION_SEND_LIMIT',
          'Too many recovery emails',
        );
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.email = :email', { email })
        .getOne();
      const active = user?.status === 'active' ? user : null;
      await repository.update(email, {
        challengeId,
        codeHash: this.codeHash(challengeId, code),
        userId: active?.id ?? null,
        credentialHash: active
          ? this.credentialHash(active.passwordHash)
          : null,
        attempts: 0,
        sendCount: first || resetWindow ? 1 : current.sendCount + 1,
        windowStartedAt: first || resetWindow ? now : current.windowStartedAt,
        sentAt: now,
        expiresAt,
        consumedAt: null,
        delivered: false,
      });
      return !!active;
    });
    // SMTP must not make the public response reveal whether an account exists.
    // Never log the address or code. A failed/restarted delivery can be retried.
    if (eligible)
      setImmediate(() => {
        void this.deliver(email, challengeId, code).catch(() => {
          this.logger.error({ code: 'PASSWORD_RESET_DELIVERY_FAILED' });
        });
      });
    return { challengeId, expiresAt, resendAfterSeconds: 60 };
  }

  private async deliver(email: string, challengeId: string, code: string) {
    await this.mail.sendCode(email, code, 'password-reset');
    await this.db
      .getRepository(PasswordReset)
      .update({ email, challengeId }, { delivered: true });
  }

  async reset(input: ResetPasswordDto) {
    if (input.newPassword !== input.confirmPassword)
      throw authError(
        400,
        'PASSWORD_CONFIRMATION_MISMATCH',
        'Passwords do not match',
      );
    const email = await this.db.transaction(async (manager) => {
      const repository = manager.getRepository(PasswordReset);
      const record = await repository
        .createQueryBuilder('reset')
        .addSelect(['reset.codeHash', 'reset.credentialHash'])
        .where('reset.challengeId = :challengeId', {
          challengeId: input.challengeId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (
        !record ||
        !record.delivered ||
        record.consumedAt ||
        !record.userId ||
        record.attempts >= 5 ||
        record.expiresAt.getTime() <= Date.now()
      )
        return null;
      if (
        !timingSafeEqual(
          Buffer.from(record.codeHash, 'hex'),
          Buffer.from(this.codeHash(input.challengeId, input.code), 'hex'),
        )
      ) {
        await repository.update(record.email, {
          attempts: record.attempts + 1,
        });
        return null; // Commit the failed attempt, then return the public error.
      }
      // Follow refresh/change-password's session-before-user lock order.
      await manager
        .getRepository(Session)
        .createQueryBuilder('session')
        .where('session.userId = :userId AND session.revokedAt IS NULL', {
          userId: record.userId,
        })
        .orderBy('session.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.id = :userId', { userId: record.userId })
        .setLock('pessimistic_write')
        .getOne();
      if (
        !user ||
        user.status !== 'active' ||
        user.email !== record.email ||
        this.credentialHash(user.passwordHash) !== record.credentialHash
      )
        return null;
      const passwordHash = await this.passwords.hash(input.newPassword);
      if (record.expiresAt.getTime() <= Date.now()) return null;
      await manager.getRepository(User).update(user.id, { passwordHash });
      await manager
        .getRepository(Session)
        .update(
          { userId: user.id, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      await repository.update(record.email, { consumedAt: new Date() });
      return record.email;
    });
    if (!email)
      throw authError(
        400,
        'INVALID_PASSWORD_RESET_CODE',
        'Code is incorrect, expired or already used',
      );
    void this.mail.sendPasswordResetNotice(email).catch(() => {
      this.logger.error({ code: 'PASSWORD_RESET_NOTICE_FAILED' });
    });
  }
}
