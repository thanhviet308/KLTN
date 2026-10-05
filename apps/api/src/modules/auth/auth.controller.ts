import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';
import { AuthService } from './auth.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- ValidationPipe needs runtime DTO metadata.
import {
  LoginDto,
  RefreshDto,
  RegisterDto,
  RequestRegistrationCodeDto,
  VerifyRegistrationCodeDto,
} from './auth.dto';
import { RegistrationService } from './registration.service';
import { Public } from './auth.decorators';
import { AuthRateLimit, AuthRateLimitGuard } from './auth-rate-limit';
import { authError } from './auth-error';

const COOKIE = 'refresh_token';
const COOKIE_PATH = '/api/v1/auth';

@UseGuards(AuthRateLimitGuard)
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
    @Inject(AuthRateLimit) private readonly limiter: AuthRateLimit,
    @Inject(RegistrationService)
    private readonly registration: RegistrationService,
  ) {}

  private client(request: Request, response: Response): 'web' | 'android' {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    const client = request.headers['x-auth-client'];
    const origin = request.headers.origin;
    if (
      client === 'web' &&
      origin === this.config.get('WEB_ORIGIN', { infer: true })
    )
      return client;
    // Native clients have no browser Origin, Fetch Metadata or cookies.
    // Reject browser requests even if they claim to be Android.
    if (
      client === 'android' &&
      !origin &&
      !request.headers['sec-fetch-site'] &&
      !request.headers.cookie
    )
      return client;
    throw authError(
      403,
      'AUTH_CLIENT_REJECTED',
      'Invalid auth client or request origin',
    );
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'strict' as const,
      path: COOKIE_PATH,
    };
  }

  private token(
    input: RefreshDto,
    request: Request,
    client: 'web' | 'android',
  ) {
    if (client === 'android') {
      if (!input.refreshToken)
        throw authError(
          400,
          'REFRESH_TOKEN_REQUIRED',
          'Refresh token is required',
        );
      return input.refreshToken;
    }
    if (input.refreshToken !== undefined)
      throw authError(
        400,
        'REFRESH_COOKIE_REQUIRED',
        'Web refresh tokens must use the HttpOnly cookie',
      );
    const values = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE}=`));
    const value =
      values.length === 1 ? values[0]!.slice(COOKIE.length + 1) : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(value))
      throw authError(
        401,
        'INVALID_REFRESH_TOKEN',
        'Refresh cookie is missing or invalid',
      );
    return value;
  }

  private respond(
    result: Awaited<ReturnType<AuthService['login']>>,
    client: 'web' | 'android',
    response: Response,
  ) {
    const { refreshToken, ...body } = result;
    if (client === 'android') return result;
    response.cookie(COOKIE, refreshToken, {
      ...this.cookieOptions(),
      expires: result.sessionExpiresAt,
    });
    return body;
  }

  @Post('register/request-code')
  @Public()
  @HttpCode(200)
  requestRegistrationCode(
    @Body() input: RequestRegistrationCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.client(request, response);
    return this.registration.requestCode(input.email);
  }

  @Post('register/verify-code')
  @Public()
  @HttpCode(200)
  verifyRegistrationCode(
    @Body() input: VerifyRegistrationCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.client(request, response);
    return this.registration.verifyCode(input.challengeId, input.code);
  }

  @Post('register')
  @Public()
  register(
    @Body() input: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.client(request, response);
    return this.auth.register(
      input,
      String(response.getHeader('x-request-id')),
    );
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const client = this.client(request, response);
    this.limiter.login(input.email, response);
    return this.respond(
      await this.auth.login(input, String(response.getHeader('x-request-id'))),
      client,
      response,
    );
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(
    @Body() input: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const client = this.client(request, response);
    try {
      return this.respond(
        await this.auth.refresh(
          this.token(input, request, client),
          String(response.getHeader('x-request-id')),
        ),
        client,
        response,
      );
    } catch (error) {
      if (
        client === 'web' &&
        error instanceof HttpException &&
        error.getStatus() === 401
      )
        response.clearCookie(COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(
    @Body() input: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const client = this.client(request, response);
    await this.auth.logout(
      this.token(input, request, client),
      String(response.getHeader('x-request-id')),
    );
    if (client === 'web') response.clearCookie(COOKIE, this.cookieOptions());
  }
}
