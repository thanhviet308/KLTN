import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { RegistrationVerification } from '../database/entities/registration-verification.entity';
import { VerificationMailService } from './verification-mail.service';
import { authError } from './auth-error';

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(VerificationMailService)
    private readonly mail: VerificationMailService,
  ) {}

  private codeHash(challenge: string, code: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    )
      .update(`registration:${challenge}:${code}`)
      .digest('hex');
  }
  private proofHash(proof: string) {
    return createHash('sha256').update(proof).digest('hex');
  }

  async requestCode(email: string) {
    this.mail.assertConfigured();
    const challengeId = randomUUID();
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60000);
    await this.db.transaction(async (manager) => {
      const repository = manager.getRepository(RegistrationVerification);
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
      if (current.challengeId === challengeId) return;
      const elapsed = now.getTime() - current.sentAt.getTime();
      if (elapsed < 60000)
        throw authError(
          429,
          'VERIFICATION_COOLDOWN',
          'Wait 60 seconds before requesting another code',
        );
      const reset =
        now.getTime() - current.windowStartedAt.getTime() >= 60 * 60000;
      if (!reset && current.sendCount >= 5)
        throw authError(
          429,
          'VERIFICATION_SEND_LIMIT',
          'Too many verification emails; try again later',
        );
      await repository.update(email, {
        challengeId,
        codeHash: this.codeHash(challengeId, code),
        proofHash: null,
        attempts: 0,
        sendCount: reset ? 1 : current.sendCount + 1,
        windowStartedAt: reset ? now : current.windowStartedAt,
        sentAt: now,
        expiresAt,
        verifiedAt: null,
        consumedAt: null,
        delivered: false,
      });
    });
    // Do not hold a database transaction open while contacting SMTP.
    await this.mail.sendCode(email, code);
    const saved = await this.db
      .getRepository(RegistrationVerification)
      .update({ email, challengeId }, { delivered: true });
    if (!saved.affected)
      throw authError(
        409,
        'VERIFICATION_REPLACED',
        'Request a new verification code',
      );
    return { challengeId, expiresAt, resendAfterSeconds: 60 };
  }

  async verifyCode(challengeId: string, code: string) {
    const result = await this.db.transaction(async (manager) => {
      const repository = manager.getRepository(RegistrationVerification);
      const record = await repository
        .createQueryBuilder('verification')
        .addSelect('verification.codeHash')
        .setLock('pessimistic_write')
        .where('verification.challengeId = :challengeId', { challengeId })
        .getOne();
      if (
        !record ||
        !record.delivered ||
        record.consumedAt ||
        record.verifiedAt ||
        record.expiresAt.getTime() <= Date.now() ||
        record.attempts >= 5
      )
        return null;
      if (
        !timingSafeEqual(
          Buffer.from(record.codeHash, 'hex'),
          Buffer.from(this.codeHash(challengeId, code), 'hex'),
        )
      ) {
        await repository.update(record.email, {
          attempts: record.attempts + 1,
        });
        return null; // Commit failed attempts before returning an error.
      }
      const verificationToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 10 * 60000);
      await repository.update(record.email, {
        verifiedAt: new Date(),
        proofHash: this.proofHash(verificationToken),
        expiresAt,
      });
      return { verificationToken, expiresAt };
    });
    if (!result)
      throw authError(
        400,
        'INVALID_VERIFICATION_CODE',
        'Code is incorrect, expired or already used',
      );
    return result;
  }

  async consume(
    email: string,
    verificationToken: string,
    manager: EntityManager,
  ) {
    const repository = manager.getRepository(RegistrationVerification);
    const record = await repository
      .createQueryBuilder('verification')
      .addSelect('verification.proofHash')
      .setLock('pessimistic_write')
      .where('verification.email = :email', { email })
      .getOne();
    if (
      !record ||
      !record.verifiedAt ||
      record.consumedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      !record.proofHash ||
      record.proofHash !== this.proofHash(verificationToken)
    ) {
      throw authError(
        400,
        'EMAIL_VERIFICATION_REQUIRED',
        'Verify your email before registering',
      );
    }
    await repository.update(email, { consumedAt: new Date() });
  }
}
