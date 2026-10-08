import { HttpException, Injectable } from '@nestjs/common';

@Injectable()
export class MessageRateLimit {
  private readonly windows = new Map<
    string,
    { start: number; send: number; receipt: number; upload: number }
  >();
  private cleanupAt = 0;

  take(userId: string, kind: 'send' | 'receipt' | 'upload') {
    const now = Date.now();
    if (now >= this.cleanupAt) {
      for (const [id, value] of this.windows)
        if (now - value.start >= 60000) this.windows.delete(id);
      this.cleanupAt = now + 60000;
    }
    let window = this.windows.get(userId);
    if (!window || now - window.start >= 60000) {
      if (!window && this.windows.size >= 10000)
        throw new HttpException(
          { code: 'MESSAGE_BUSY', message: 'Messaging capacity reached' },
          429,
        );
      window = { start: now, send: 0, receipt: 0, upload: 0 };
      this.windows.set(userId, window);
    }
    if (++window[kind] > (kind === 'upload' ? 30 : kind === 'send' ? 60 : 600))
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many messaging requests' },
        429,
      );
  }
}
