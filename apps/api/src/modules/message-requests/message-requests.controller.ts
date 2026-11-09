import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
import { MessageRequestsService } from './message-requests.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO metadata is required by ValidationPipe.
import {
  CreateMessageRequestDto,
  MessageRequestsQueryDto,
  RespondMessageRequestDto,
} from './message-requests.dto';

@Controller('message-requests')
export class MessageRequestsController {
  constructor(
    @Inject(MessageRequestsService)
    private readonly requests: MessageRequestsService,
  ) {}

  @Post()
  @HttpCode(200)
  create(@CurrentUser() user: User, @Body() input: CreateMessageRequestDto) {
    return this.requests.create(user.id, input);
  }

  @Get()
  list(@CurrentUser() user: User, @Query() input: MessageRequestsQueryDto) {
    return this.requests.list(user.id, input);
  }

  @Patch(':id')
  respond(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: RespondMessageRequestDto,
  ) {
    return this.requests.respond(user.id, id, input.action);
  }
}
