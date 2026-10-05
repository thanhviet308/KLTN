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
import { FriendshipsService } from './friendships.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO metadata needed by ValidationPipe.
import {
  CreateFriendRequestDto,
  FriendRequestsQueryDto,
  RespondFriendRequestDto,
} from './friendships.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO metadata needed by ValidationPipe.
import { PageDto } from '../../common/page.dto';

@Controller()
export class FriendshipsController {
  constructor(
    @Inject(FriendshipsService)
    private readonly friendships: FriendshipsService,
  ) {}

  @Post('friend-requests')
  @HttpCode(200)
  request(@CurrentUser() user: User, @Body() input: CreateFriendRequestDto) {
    return this.friendships.request(user.id, input.recipientId);
  }

  @Get('friend-requests')
  requests(@CurrentUser() user: User, @Query() input: FriendRequestsQueryDto) {
    return this.friendships.requests(user.id, input);
  }

  @Patch('friend-requests/:id')
  respond(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: RespondFriendRequestDto,
  ) {
    return this.friendships.respond(user.id, id, input.action);
  }

  @Get('friends')
  friends(@CurrentUser() user: User, @Query() input: PageDto) {
    return this.friendships.friends(user.id, input);
  }

  @Delete('friends/:userId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: User,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
  ) {
    return this.friendships.remove(user.id, userId);
  }
}
