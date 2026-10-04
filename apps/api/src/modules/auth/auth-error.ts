import { HttpException } from '@nestjs/common';

export function authError(status: number, code: string, message: string) {
  return new HttpException({ code, message }, status);
}
