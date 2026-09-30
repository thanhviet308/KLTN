import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import type { Environment } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService<Environment, true>);
  const env: Environment = {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    HOST: config.get('HOST', { infer: true }),
    PORT: config.get('PORT', { infer: true }),
    WEB_ORIGIN: config.get('WEB_ORIGIN', { infer: true }),
  };
  configureApp(app, env);
  await app.listen(env.PORT, env.HOST);
  Logger.log(`API listening on ${await app.getUrl()}/api/v1`, 'Bootstrap');
}

void bootstrap().catch(() => {
  Logger.error(
    'API startup failed; check configuration and port availability',
    'Bootstrap',
  );
  process.exitCode = 1;
});
