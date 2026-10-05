import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { authError } from './auth-error';

@Injectable()
export class VerificationMailService {
  private readonly logger = new Logger(VerificationMailService.name);
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private options() {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');
    const from = this.config.get<string>('SMTP_FROM');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? '587');
    if (
      !host ||
      !user ||
      !pass ||
      !from ||
      /[\r\n]/.test(from) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw authError(
        503,
        'MAIL_NOT_CONFIGURED',
        'Email delivery is not configured',
      );
    }
    return { host, user, pass, from, port };
  }

  assertConfigured() {
    this.options();
  }

  async sendCode(email: string, code: string): Promise<void> {
    const options = this.options();
    const transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
      requireTLS: true,
      auth: { user: options.user, pass: options.pass },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      logger: false,
      debug: false,
    });
    try {
      const result = await transport.sendMail({
        from: options.from,
        to: email,
        subject: 'Mã xác minh đăng ký Halo',
        text: `Mã xác minh của bạn là: ${code}\nMã có hiệu lực trong 10 phút. Không chia sẻ mã này với người khác.\nNếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.`,
      });
      if (!result.accepted?.length) throw new Error('Mail rejected');
    } catch {
      this.logger.error({ code: 'VERIFICATION_MAIL_FAILED' });
      throw authError(
        503,
        'MAIL_DELIVERY_FAILED',
        'Cannot send verification email; try again later',
      );
    } finally {
      transport.close();
    }
  }
}
