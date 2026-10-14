import {
  Controller,
  Get,
  Header,
  Inject,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Environment } from '../../config/environment';
import { Public } from '../auth/auth.decorators';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ status: string }> {
    try {
      await this.database.ping();
      const revision = this.config.get('DEPLOYMENT_REVISION', { infer: true });
      if (revision) response.setHeader('X-PingPong-Revision', revision);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Service unavailable');
    }
  }
}
