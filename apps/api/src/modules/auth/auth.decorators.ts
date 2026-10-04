import { SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../database/entities/user.entity';

export const PUBLIC_ROUTE = 'auth:public';
export const ROLES = 'auth:roles';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: User['role'][]) => SetMetadata(ROLES, roles);

export interface AuthPrincipal {
  user: User;
  sessionId: string;
}
export type AuthRequest = Request & { principal: AuthPrincipal };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User =>
    context.switchToHttp().getRequest<AuthRequest>().principal.user,
);
