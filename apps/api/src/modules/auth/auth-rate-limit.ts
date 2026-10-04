import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { authError } from './auth-error';

@Injectable()
export class AuthRateLimit {
  private readonly entries = new Map<
    string,
    { count: number; until: number }
  >();

  take(key: string, limit: number, windowMs: number, response: Response) {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= 10000) {
        for (const [storedKey, stored] of this.entries) {
          if (stored.until <= now) this.entries.delete(storedKey);
        }
        if (this.entries.size >= 10000) {
          throw authError(
            503,
            'AUTH_BUSY',
            'Authentication is busy; try again later',
          );
        }
      }
      entry = { count: 0, until: now + windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= limit) {
      response.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
      throw authError(
        429,
        'AUTH_RATE_LIMITED',
        'Too many attempts; try again later',
      );
    }
    entry.count++;
  }

  login(email: string, response: Response) {
    const key = createHash('sha256').update(email).digest('hex');
    this.take(`email:${key}`, 10, 15 * 60 * 1000, response);
  }
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: AuthRateLimit) {}

  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    // Express does not trust forwarded IP headers. Configure proxy trust only
    // for a verified deployment topology, never for arbitrary clients.
    this.limiter.take(
      `ip:${request.ip ?? request.socket.remoteAddress}`,
      30,
      60000,
      http.getResponse<Response>(),
    );
    return true;
  }
}
