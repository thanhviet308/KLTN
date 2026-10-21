import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO runtime metadata.
import { PageDto } from '../../common/page.dto';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
import { CallsService } from './calls.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO runtime metadata.
import { CreateCallDto } from './calls.dto';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller()
export class CallsController {
  constructor(@Inject(CallsService) private readonly calls: CallsService) {}

  @Post('conversations/:conversationId/calls')
  @HttpCode(200)
  create(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) conversationId: string,
    @Body() input: CreateCallDto,
  ) {
    return this.calls.create(user.id, conversationId.toLowerCase(), input);
  }

  @Get('calls')
  list(@CurrentUser() user: User, @Query() input: PageDto) {
    return this.calls.list(user.id, input);
  }

  @Get('calls/:id')
  get(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.calls.get(user.id, id.toLowerCase());
  }

  @Post('calls/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.calls.accept(user.id, id.toLowerCase());
  }

  @Post('calls/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.calls.reject(user.id, id.toLowerCase());
  }

  @Post('calls/:id/leave')
  @HttpCode(200)
  leave(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.calls.leave(user.id, id.toLowerCase());
  }

  @Post('calls/:id/end')
  @HttpCode(200)
  end(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.calls.end(user.id, id.toLowerCase());
  }

  @Post('calls/:id/token')
  @HttpCode(200)
  token(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.calls.token(user.id, id.toLowerCase());
  }
}
