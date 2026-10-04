import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { PUBLIC_ROUTE, ROLES } from './auth.decorators';
import type { AuthRequest } from './auth.decorators';
import type { User } from '../database/entities/user.entity';
import { authError } from './auth-error';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets))
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.headers.authorization;
    if (
      !header ||
      header.length > 2048 ||
      !/^Bearer [A-Za-z0-9_.-]+$/.test(header)
    ) {
      throw authError(401, 'AUTH_REQUIRED', 'A valid access token is required');
    }
    request.principal = await this.auth.authenticate(header.slice(7));
    const roles = this.reflector.getAllAndOverride<User['role'][]>(
      ROLES,
      targets,
    );
    if (roles && !roles.includes(request.principal.user.role)) {
      throw authError(403, 'FORBIDDEN', 'Insufficient permissions');
    }
    return true;
  }
}
