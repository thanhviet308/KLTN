import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = String(response.getHeader('x-request-id') ?? '');
    let message: string | string[] = 'Internal server error';

    // Body-parser errors are not Nest HttpExceptions. Map only known input errors.
    if (
      exception instanceof Error &&
      'type' in exception &&
      exception.type === 'entity.too.large'
    ) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'Request body exceeds the size limit';
    }

    if (status < 500 && exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if ('message' in body) {
        const candidate: unknown = body.message;
        if (
          typeof candidate === 'string' ||
          (Array.isArray(candidate) &&
            candidate.every((item) => typeof item === 'string'))
        ) {
          message = candidate;
        }
      }
    }
    if (status >= 500) {
      // Do not log exception messages, request bodies or credentials by default.
      this.logger.error({ requestId, status, code: 'INTERNAL_SERVER_ERROR' });
    }
    response.status(status).json({
      code: status >= 500 ? 'INTERNAL_SERVER_ERROR' : `HTTP_${status}`,
      message,
      requestId,
    });
  }
}
