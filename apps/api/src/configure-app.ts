import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { HttpEnvironment } from './config/environment';
import { HttpExceptionFilter } from './common/http-exception.filter';

export function configureApp(
  app: INestApplication,
  env: HttpEnvironment,
): void {
  app.setGlobalPrefix('api/v1');
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('x-request-id', randomUUID());
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet());
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}
