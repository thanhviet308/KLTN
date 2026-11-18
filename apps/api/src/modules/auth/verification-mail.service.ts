import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { authError } from './auth-error';

@Injectable()
export class VerificationMailService {
  private readonly logger = new Logger(VerificationMailService.name);
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private stripOuterQuotes(value?: string): string {
    const trimmed = value?.trim() ?? '';
    if (
      trimmed.length >= 2 &&
      ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }

  private options() {
    const host = this.stripOuterQuotes(
      this.config.get<string>('SMTP_HOST'),
    ).toLowerCase();
    const user = this.stripOuterQuotes(this.config.get<string>('SMTP_USER'));
    const rawPass = this.stripOuterQuotes(
      this.config.get<string>('SMTP_PASSWORD'),
    );
    const isGmail = host === 'smtp.gmail.com' || host === 'smtp.googlemail.com';
    const pass = isGmail ? rawPass.replace(/\s+/g, '') : rawPass;
    const from = this.stripOuterQuotes(this.config.get<string>('SMTP_FROM'));
    const portText = this.stripOuterQuotes(
      this.config.get<string>('SMTP_PORT') ?? '587',
    );
    const port = Number(portText || '587');
    if (
      !host ||
      host === 'smtp.example.com' ||
      !user ||
      user === 'CHANGE_ME' ||
      !pass ||
      pass === 'CHANGE_ME' ||
      !from ||
      from === 'CHANGE_ME' ||
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

  async sendCode(
    email: string,
    code: string,
    purpose: 'registration' | 'password-reset' = 'registration',
  ): Promise<void> {
    const reset = purpose === 'password-reset';
    await this.sendMessage(
      email,
      reset ? 'Mã đặt lại mật khẩu PingPong' : 'Mã xác minh đăng ký PingPong',
      `Mã ${reset ? 'đặt lại mật khẩu' : 'xác minh'} của bạn là: ${code}\nMã có hiệu lực trong 10 phút. Không chia sẻ mã này với người khác.\nNếu bạn không yêu cầu ${reset ? 'đặt lại mật khẩu' : 'đăng ký'}, hãy bỏ qua email này.`,
    );
  }

  async sendPasswordResetNotice(email: string): Promise<void> {
    await this.sendMessage(
      email,
      'Mật khẩu PingPong đã được đặt lại',
      'Mật khẩu tài khoản của bạn vừa được đặt lại. Các phiên đăng nhập cũ đã được đăng xuất. Nếu không phải bạn thực hiện, hãy dùng Quên mật khẩu để khôi phục tài khoản ngay.',
    );
  }

  private async sendMessage(
    email: string,
    subject: string,
    text: string,
  ): Promise<void> {
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
        subject,
        text,
      });
      if (!result.accepted?.length) throw new Error('Mail rejected');
    } catch (error) {
      const smtpError = error as {
        code?: string;
        responseCode?: number;
        command?: string;
      };
      this.logger.error({
        code: 'VERIFICATION_MAIL_FAILED',
        smtpCode: smtpError?.code ?? null,
        responseCode: smtpError?.responseCode ?? null,
        command: smtpError?.command ?? null,
        port: options.port,
      });
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
