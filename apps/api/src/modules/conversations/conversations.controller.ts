import {
  Body,
  Controller,
  Delete,
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
import { ConversationsService } from './conversations.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Runtime DTO metadata for validation.
import {
  CreateConversationDto,
  UpdateConversationDto,
  AddConversationMemberDto,
  UpdateConversationMemberDto,
  TransferOwnershipDto,
} from './conversations.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Runtime DTO metadata for validation.
import { PageDto } from '../../common/page.dto';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller('conversations')
export class ConversationsController {
  constructor(
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
  ) {}

  @Post()
  @HttpCode(200)
  create(@CurrentUser() user: User, @Body() input: CreateConversationDto) {
    return this.conversations.create(user.id, input);
  }

  @Get()
  list(@CurrentUser() user: User, @Query() input: PageDto) {
    return this.conversations.list(user.id, input);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.conversations.get(user.id, id.toLowerCase());
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Body() input: UpdateConversationDto,
  ) {
    return this.conversations.rename(user.id, id.toLowerCase(), input.title);
  }

  @Get(':id/members')
  members(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Query() input: PageDto,
  ) {
    return this.conversations.members(user.id, id.toLowerCase(), input);
  }

  @Post(':id/members')
  @HttpCode(200)
  add(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Body() input: AddConversationMemberDto,
  ) {
    return this.conversations.addMember(
      user.id,
      id.toLowerCase(),
      input.userId,
    );
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
  ) {
    return this.conversations.removeMember(
      user.id,
      id.toLowerCase(),
      userId.toLowerCase(),
    );
  }

  @Patch(':id/members/:userId')
  role(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
    @Body() input: UpdateConversationMemberDto,
  ) {
    return this.conversations.role(
      user.id,
      id.toLowerCase(),
      userId.toLowerCase(),
      input.role,
    );
  }

  @Post(':id/transfer-ownership')
  @HttpCode(200)
  transfer(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Body() input: TransferOwnershipDto,
  ) {
    return this.conversations.transfer(user.id, id.toLowerCase(), input.userId);
  }
}
