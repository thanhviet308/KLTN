import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import type { Environment, HttpEnvironment } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    abortOnError: false,
  });
  try {
    const config = app.get(ConfigService<Environment, true>);
    const env: HttpEnvironment = {
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      HOST: config.get('HOST', { infer: true }),
      PORT: config.get('PORT', { infer: true }),
      WEB_ORIGIN: config.get('WEB_ORIGIN', { infer: true }),
      TRUST_PROXY: config.get('TRUST_PROXY', { infer: true }),
    };
    configureApp(app, env);
    await app.listen(env.PORT, env.HOST);
    Logger.log(`API listening on ${await app.getUrl()}/api/v1`, 'Bootstrap');
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'STARTUP_FAILED';
  Logger.error(
    code === 'EADDRINUSE'
      ? 'API port is already in use (EADDRINUSE). Stop the existing API process or configure another PORT.'
      : `API startup failed (${/^[A-Z0-9_]+$/.test(code) ? code : 'STARTUP_FAILED'}); check configuration and database availability`,
    'Bootstrap',
  );
  process.exitCode = 1;
});
