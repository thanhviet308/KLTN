import type { User } from '../database/entities/user.entity';

export function userView(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarKey?.startsWith('/users/avatars/')
      ? user.avatarKey
      : null,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
}

export function publicUserView(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarKey?.startsWith('/users/avatars/')
      ? user.avatarKey
      : null,
  };
}
