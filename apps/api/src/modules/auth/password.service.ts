import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { authError } from './auth-error';

@Injectable()
export class PasswordService implements OnModuleInit {
  private running = 0;
  private dummyHash!: string;

  async onModuleInit() {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  private async derive(password: string, salt: Buffer): Promise<Buffer> {
    // Bound expensive work: each scrypt operation uses about 128 MiB.
    if (this.running >= 2) {
      throw authError(
        503,
        'AUTH_BUSY',
        'Authentication is busy; try again later',
      );
    }
    this.running++;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(
          password,
          salt,
          64,
          { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
          (error, key) => {
            if (error) reject(error);
            else resolve(key);
          },
        );
      });
    } finally {
      this.running--;
    }
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await this.derive(password, salt);
    return `scrypt$131072$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(password: string, hash?: string): Promise<boolean> {
    const encoded = hash ?? this.dummyHash;
    const match =
      /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
    if (!match) throw new Error('Unsupported stored password hash');
    const key = await this.derive(password, Buffer.from(match[1]!, 'hex'));
    const valid = timingSafeEqual(key, Buffer.from(match[2]!, 'hex'));
    return hash !== undefined && valid;
  }
}
