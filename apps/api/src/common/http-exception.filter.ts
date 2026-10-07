import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

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
    let code = status >= 500 ? 'INTERNAL_SERVER_ERROR' : `HTTP_${status}`;

    // Body-parser errors are not Nest HttpExceptions. Map only known input errors.
    if (
      exception instanceof Error &&
      'type' in exception &&
      exception.type === 'entity.too.large'
    ) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      code = 'HTTP_413';
      message = 'Request body exceeds the size limit';
    }

    if (
      exception instanceof Error &&
      'type' in exception &&
      exception.type === 'entity.parse.failed'
    ) {
      status = HttpStatus.BAD_REQUEST;
      code = 'HTTP_400';
      message = 'Malformed JSON body';
    }

    const publicServiceError =
      status === 503 &&
      exception instanceof HttpException &&
      typeof exception.getResponse() === 'object' &&
      ['MAIL_NOT_CONFIGURED', 'MAIL_DELIVERY_FAILED', 'AUTH_BUSY'].includes(
        String((exception.getResponse() as { code?: unknown }).code),
      );
    if (
      (status < 500 || publicServiceError) &&
      exception instanceof HttpException
    ) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if ('message' in body) {
        if (
          'code' in body &&
          typeof body.code === 'string' &&
          /^[A-Z][A-Z0-9_]{0,63}$/.test(body.code)
        )
          code = body.code;
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
      const request = host.switchToHttp().getRequest<Request>();
      const failure =
        exception && typeof exception === 'object'
          ? (exception as {
              name?: unknown;
              code?: unknown;
              driverError?: { code?: unknown };
              stack?: unknown;
            })
          : undefined;
      const rawCode = String(failure?.driverError?.code ?? failure?.code ?? '');
      const route: unknown = request.route?.path;
      this.logger.error({
        requestId,
        status,
        code,
        method: request.method,
        route: typeof route === 'string' ? route : 'UNRESOLVED_ROUTE',
        errorType:
          typeof failure?.name === 'string' &&
          /^[A-Za-z]+Error$/.test(failure.name)
            ? failure.name
            : 'UnknownError',
        causeCode: /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : undefined,
        frames:
          typeof failure?.stack === 'string'
            ? failure.stack
                .split('\n')
                .filter((line) => /^\s+at /.test(line))
                .slice(0, 8)
            : undefined,
      });
    }
    response.status(status).json({
      code:
        status >= 500 && !publicServiceError ? 'INTERNAL_SERVER_ERROR' : code,
      message,
      requestId,
    });
  }
}
