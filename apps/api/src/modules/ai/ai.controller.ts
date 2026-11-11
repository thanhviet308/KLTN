import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- ValidationPipe needs runtime DTO metadata.
import { AiChatRequestDto, AiRequestDto } from './ai.dto';
import { AiService } from './ai.service';
import { AiProviderService } from './ai-provider.service';

@Controller()
export class AiController {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(AiProviderService) private readonly provider: AiProviderService,
  ) {}

  @Get('ai/status')
  status(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return { enabled: this.provider.available() };
  }

  @Post('ai/chat')
  @HttpCode(200)
  chat(
    @CurrentUser() user: User,
    @Body() input: AiChatRequestDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.ai.chat(user.id, input);
  }

  @Post('conversations/:id/ai')
  @HttpCode(200)
  generate(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: AiRequestDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.ai.generate(user.id, id, input);
  }
}
