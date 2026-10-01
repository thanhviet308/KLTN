import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Environment } from '../../config/environment';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: 10,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      query_timeout: 6000,
      application_name: 'realtime-chat-api',
      options: '-c timezone=UTC',
    });
    this.pool.on('error', () => {
      this.logger.error('PostgreSQL idle connection failed');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ping();
      this.logger.log('PostgreSQL connection established');
    } catch {
      await this.pool.end();
      throw new Error(
        'PostgreSQL connection failed; check DATABASE_URL and server availability',
      );
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.pool.ended) {
      await this.pool.end();
    }
  }
}
