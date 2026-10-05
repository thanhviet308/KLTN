import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { publicUserView, userView } from './user-view';
import type { SearchUsersDto, UpdateProfileDto } from './users.dto';
import { pageResult } from '../../common/page.dto';

interface CreateAccountInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
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
      .select(['user.id', 'user.displayName'])
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
