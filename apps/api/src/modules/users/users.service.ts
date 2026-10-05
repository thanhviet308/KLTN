import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { userView } from './user-view';

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
}
