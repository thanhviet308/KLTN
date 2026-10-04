import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Environment } from '../../config/environment';
import { typeormOptions } from './typeorm-options';
import { DatabaseService } from './database.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        ...typeormOptions(config.get('DATABASE_URL', { infer: true })),
        retryAttempts: 1,
        verboseRetryLog: false,
      }),
      dataSourceFactory: async (options) => {
        if (!options) throw new Error('Database configuration is missing');
        const dataSource = new DataSource(options);
        try {
          return await dataSource.initialize();
        } catch {
          if (dataSource.isInitialized) await dataSource.destroy();
          throw new Error(
            'PostgreSQL initialization failed; check database configuration and availability',
          );
        }
      },
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
