import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { User } from '../database/entities/user.entity';
import { Session } from '../database/entities/session.entity';
import { SessionRefreshToken } from '../database/entities/session-refresh-token.entity';
import { PasswordService } from './password.service';
import type { LoginDto, RegisterDto, ChangePasswordDto } from './auth.dto';
import { authError } from './auth-error';
import { userView } from '../users/user-view';
import { UsersService } from '../users/users.service';
import { RegistrationService } from './registration.service';

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_SECONDS = 15 * 60;
const ISSUER = 'realtime-chat-api';
const AUDIENCE = 'realtime-chat-client';

@Injectable()
export class AuthService {
  async changePassword(userId: string, input: ChangePasswordDto) {
    if (input.newPassword !== input.confirmPassword)
      throw authError(
        400,
        'PASSWORD_CONFIRMATION_MISMATCH',
        'Passwords do not match',
      );
    if (input.currentPassword === input.newPassword)
      throw authError(400, 'PASSWORD_UNCHANGED', 'Choose a different password');
    const candidate = await this.db
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :userId', { userId })
      .getOne();
    if (
      !candidate ||
      !(await this.passwords.verify(
        input.currentPassword,
        candidate.passwordHash,
      ))
    )
      throw authError(
        400,
        'CURRENT_PASSWORD_INVALID',
        'Current password is incorrect',
      );
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.db.transaction(async (manager) => {
      // Refresh locks sessions before users; follow that order to avoid deadlocks.
      await manager
        .getRepository(Session)
        .createQueryBuilder('session')
        .where('session.userId = :userId AND session.revokedAt IS NULL', {
          userId,
        })
        .orderBy('session.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();
      if (
        !user ||
        user.status !== 'active' ||
        user.passwordHash !== candidate.passwordHash
      )
        throw authError(
          409,
          'PASSWORD_STATE_CONFLICT',
          'Account changed; try again',
        );
      await manager.getRepository(User).update(userId, { passwordHash });
      await manager
        .getRepository(Session)
        .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    });
  }
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RegistrationService)
    private readonly registration: RegistrationService,
  ) {}

  async register(input: RegisterDto, requestId: string) {
    if (input.password !== input.confirmPassword)
      throw authError(
        400,
        'PASSWORD_CONFIRMATION_MISMATCH',
        'Passwords do not match',
      );
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.db.transaction(async (manager) => {
      await this.registration.consume(
        input.email,
        input.verificationToken,
        manager,
      );
      return this.users.createAccount(
        { email: input.email, displayName: input.displayName, passwordHash },
        manager,
      );
    });
    this.logger.log({ code: 'USER_REGISTERED', userId: user.id, requestId });
    return { user: userView(user) };
  }

  async login(input: LoginDto, requestId: string) {
    const startedAt = performance.now();
    const candidate = await this.users.findCredentialsByEmail(input.email);
    const credentialsLoadedAt = performance.now();
    const valid = await this.passwords.verify(
      input.password,
      candidate?.passwordHash,
    );
    const passwordVerifiedAt = performance.now();
    if (!valid || !candidate || candidate.status !== 'active') {
      this.logger.warn({ code: 'LOGIN_REJECTED', requestId });
      throw authError(
        401,
        'INVALID_CREDENTIALS',
        'Email or password is incorrect',
      );
    }
    const result = await this.db.transaction(async (manager) => {
      // Recheck under lock after expensive hashing, including a password change.
      const user = await this.users.findCredentialsByIdForShare(
        candidate.id,
        manager,
      );
      if (
        !user ||
        user.status !== 'active' ||
        user.passwordHash !== candidate.passwordHash
      ) {
        throw authError(
          401,
          'INVALID_CREDENTIALS',
          'Email or password is incorrect',
        );
      }
      const session = manager.getRepository(Session).create({
        id: randomUUID(),
        userId: user.id,
        deviceName: input.deviceName ?? null,
        expiresAt: new Date(Date.now() + SESSION_MS),
      });
      return this.issue(manager, session, user, true);
    });
    this.logger.log({
      code: 'LOGIN_SUCCEEDED',
      durationMs: Math.round(performance.now() - startedAt),
      credentialsMs: Math.round(credentialsLoadedAt - startedAt),
      passwordVerifyMs: Math.round(passwordVerifiedAt - credentialsLoadedAt),
      sessionIssueMs: Math.round(performance.now() - passwordVerifiedAt),
      userId: result.user.id,
      requestId,
    });
    return result;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issue(
    manager: EntityManager,
    session: Session,
    user: User,
    newSession = false,
  ) {
    const refreshToken = randomBytes(32).toString('base64url');
    if (newSession) {
      // Both records are created atomically in one round trip, under the user
      // lock already acquired by login's transaction.
      await manager.query(
        `
        WITH created_session AS (
          INSERT INTO sessions (id, user_id, device_name, expires_at)
          VALUES ($1, $2, $3, $4) RETURNING id
        )
        INSERT INTO session_refresh_tokens (session_id, token_hash, expires_at)
        SELECT id, $5, $4 FROM created_session
      `,
        [
          session.id,
          user.id,
          session.deviceName,
          session.expiresAt,
          this.hashToken(refreshToken),
        ],
      );
    } else {
      await manager.getRepository(SessionRefreshToken).insert({
        sessionId: session.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: session.expiresAt,
      });
    }
    const expiresIn = Math.min(
      ACCESS_SECONDS,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
    );
    if (expiresIn < 1)
      throw authError(401, 'SESSION_EXPIRED', 'Session has expired');
    const accessToken = await this.jwt.signAsync(
      { sid: session.id, type: 'access' },
      {
        algorithm: 'HS256',
        issuer: ISSUER,
        audience: AUDIENCE,
        subject: user.id,
        jwtid: randomUUID(),
        expiresIn,
      },
    );
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn,
      sessionExpiresAt: session.expiresAt,
      user: userView(user),
    };
  }

  async refresh(rawToken: string, requestId: string) {
    const result = await this.db.transaction(async (manager) => {
      const tokens = manager.getRepository(SessionRefreshToken);
      const found = await tokens.findOneBy({
        tokenHash: this.hashToken(rawToken),
      });
      if (!found) return null;
      // Every rotation/logout locks the parent first, serializing the session.
      const session = await manager.getRepository(Session).findOne({
        where: { id: found.sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session || session.revokedAt) return null;
      const token = await tokens.findOneByOrFail({ id: found.id });
      if (token.consumedAt) {
        await manager
          .getRepository(Session)
          .update(session.id, { revokedAt: new Date() });
        this.logger.warn({
          code: 'REFRESH_TOKEN_REUSED',
          sessionId: session.id,
          requestId,
        });
        // Return instead of throwing: revocation must commit before the 401.
        return null;
      }
      const user = await this.users.findByIdForShare(session.userId, manager);
      if (
        !user ||
        user.status !== 'active' ||
        session.expiresAt.getTime() <= Date.now() ||
        token.expiresAt.getTime() <= Date.now()
      ) {
        await manager
          .getRepository(Session)
          .update(session.id, { revokedAt: new Date() });
        return null;
      }
      await tokens.update(token.id, { consumedAt: new Date() });
      return this.issue(manager, session, user);
    });
    if (!result)
      throw authError(
        401,
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid or expired',
      );
    return result;
  }

  async logout(rawToken: string, requestId: string) {
    await this.db.transaction(async (manager) => {
      const token = await manager
        .getRepository(SessionRefreshToken)
        .findOneBy({ tokenHash: this.hashToken(rawToken) });
      if (!token) return;
      const session = await manager.getRepository(Session).findOne({
        where: { id: token.sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (session && !session.revokedAt) {
        await manager
          .getRepository(Session)
          .update(session.id, { revokedAt: new Date() });
      }
    });
    this.logger.log({ code: 'LOGOUT_COMPLETED', requestId });
  }

  async authenticate(rawToken: string) {
    let payload: {
      sub?: unknown;
      sid?: unknown;
      type?: unknown;
      exp?: unknown;
    };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch {
      throw authError(
        401,
        'INVALID_ACCESS_TOKEN',
        'Access token is invalid or expired',
      );
    }
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      payload.type !== 'access' ||
      typeof payload.exp !== 'number' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      !uuid.test(payload.sub) ||
      !uuid.test(payload.sid)
    ) {
      throw authError(
        401,
        'INVALID_ACCESS_TOKEN',
        'Access token is invalid or expired',
      );
    }
    const session = await this.db.getRepository(Session).findOne({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      relations: { user: true },
    });
    if (!session || session.user.status !== 'active') {
      throw authError(401, 'SESSION_INACTIVE', 'Session is no longer active');
    }
    return { user: session.user, sessionId: session.id };
  }
}
