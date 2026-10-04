import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { User } from '../database/entities/user.entity';
import { Session } from '../database/entities/session.entity';
import { SessionRefreshToken } from '../database/entities/session-refresh-token.entity';
import { PasswordService } from './password.service';
import type { LoginDto, RegisterDto } from './auth.dto';
import { authError } from './auth-error';
import { userView } from '../users/user-view';
import { UsersService } from '../users/users.service';

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_SECONDS = 15 * 60;
const ISSUER = 'realtime-chat-api';
const AUDIENCE = 'realtime-chat-client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  async register(input: RegisterDto, requestId: string) {
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.createAccount({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
    });
    this.logger.log({ code: 'USER_REGISTERED', userId: user.id, requestId });
    return { user: userView(user) };
  }

  async login(input: LoginDto, requestId: string) {
    const candidate = await this.users.findCredentialsByEmail(input.email);
    const valid = await this.passwords.verify(
      input.password,
      candidate?.passwordHash,
    );
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
      const session = await manager.getRepository(Session).save({
        userId: user.id,
        deviceName: input.deviceName ?? null,
        expiresAt: new Date(Date.now() + SESSION_MS),
      });
      return this.issue(manager, session, user);
    });
    this.logger.log({
      code: 'LOGIN_SUCCEEDED',
      userId: result.user.id,
      requestId,
    });
    return result;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issue(manager: EntityManager, session: Session, user: User) {
    const refreshToken = randomBytes(32).toString('base64url');
    await manager.getRepository(SessionRefreshToken).save({
      sessionId: session.id,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: session.expiresAt,
    });
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
