import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { publicUserView, userView } from './user-view';
import type { SearchUsersDto, UpdateProfileDto } from './users.dto';
import { pageResult } from '../../common/page.dto';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

interface CreateAccountInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  private processingAvatars = 0;
  async updateAvatar(userId: string, image: string | null) {
    let data: Buffer | null = null;
    if (image !== null) {
      if (this.processingAvatars >= 2) throw new ServiceUnavailableException();
      this.processingAvatars++;
      try {
        const raw = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
        if (!raw.length || raw.length > 512 * 1024) throw new Error('SIZE');
        const metadata = await sharp(raw, {
          limitInputPixels: 16000000,
        }).metadata();
        if (
          !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
          (metadata.pages ?? 1) > 1
        )
          throw new Error('FORMAT');
        data = await sharp(raw, { limitInputPixels: 16000000 })
          .rotate()
          .resize(256, 256, { fit: 'cover' })
          .webp({ quality: 80 })
          .toBuffer();
        if (data.length > 131072) throw new Error('SIZE');
      } catch {
        throw new BadRequestException({
          code: 'AVATAR_INVALID',
          message: 'Use a valid non-animated PNG, JPEG or WebP under 512 KiB',
        });
      } finally {
        this.processingAvatars--;
      }
    }
    return this.users.manager.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .findOne({
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
      if (!user || user.status !== 'active') throw new UnauthorizedException();
      if (data) {
        const version = randomUUID();
        await manager.query(
          `INSERT INTO user_avatars(user_id, version, data) VALUES($1,$2,$3)
          ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version, data=EXCLUDED.data`,
          [userId, version, data],
        );
        user.avatarKey = `/users/avatars/${version}`;
      } else {
        await manager.query('DELETE FROM user_avatars WHERE user_id=$1', [
          userId,
        ]);
        user.avatarKey = null;
      }
      await manager.getRepository(User).save(user);
      return { user: userView(user) };
    });
  }
  async avatar(version: string) {
    const rows: { data: Buffer }[] = await this.users.manager.query(
      `SELECT a.data FROM user_avatars a
      JOIN users u ON u.id=a.user_id WHERE a.version=$1 AND u.status='active'`,
      [version],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0].data;
  }
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async createAccount(
    input: CreateAccountInput,
    manager?: EntityManager,
  ): Promise<User> {
    const repository = manager ? manager.getRepository(User) : this.users;
    try {
      return await repository.save({
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        role: 'user',
        status: 'active',
      });
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const driver = error.driverError as {
          code?: string;
          constraint?: string;
        };
        const emailConflict = this.users.metadata.uniques.some(
          (unique) =>
            unique.name === driver.constraint &&
            unique.columns.some((column) => column.propertyName === 'email'),
        );
        if (driver.code === '23505' && emailConflict) {
          throw new ConflictException({
            code: 'EMAIL_ALREADY_REGISTERED',
            message: 'Email is already registered',
          });
        }
      }
      throw error;
    }
  }

  findCredentialsByEmail(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  // Use the caller's transaction manager so the lock lasts through session creation.
  findCredentialsByIdForShare(
    id: string,
    manager: EntityManager,
  ): Promise<User | null> {
    return manager
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .setLock('pessimistic_read')
      .where('user.id = :id', { id })
      .getOne();
  }

  findByIdForShare(id: string, manager: EntityManager): Promise<User | null> {
    return manager.getRepository(User).findOne({
      where: { id },
      lock: { mode: 'pessimistic_read' },
    });
  }

  getCurrentProfile(user: User) {
    // The guard already fetched the current user; do not query it twice.
    return { user: userView(user) };
  }

  async updateProfile(id: string, input: UpdateProfileDto) {
    return this.users.manager.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!user || user.status !== 'active')
        throw new UnauthorizedException('Account is inactive');
      user.displayName = input.displayName;
      return { user: userView(await manager.getRepository(User).save(user)) };
    });
  }

  async search(currentUserId: string, input: SearchUsersDto) {
    // Escape SQL LIKE metacharacters: the search is literal, not a client pattern.
    const text = input.query.replace(/[\\%_]/g, '\\$&');
    const query = this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.displayName', 'user.avatarKey'])
      .where("user.status = 'active'")
      .andWhere('user.id <> :currentUserId', { currentUserId })
      .andWhere("user.displayName ILIKE :name ESCAPE '\\'", {
        name: `%${text}%`,
      })
      .orderBy('user.id', 'ASC')
      .take(input.limit + 1);
    if (input.cursor)
      query.andWhere('user.id > :cursor', { cursor: input.cursor });
    return pageResult((await query.getMany()).map(publicUserView), input.limit);
  }
}
