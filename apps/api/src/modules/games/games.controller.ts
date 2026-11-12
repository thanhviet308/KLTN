import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
import { GamesService } from './games.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO runtime metadata.
import { CreateGameDto, GameMoveDto } from './games.dto';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller()
export class GamesController {
  constructor(@Inject(GamesService) private readonly games: GamesService) {}

  @Get('conversations/:conversationId/games/current')
  current(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) conversationId: string,
  ) {
    return this.games.current(user.id, conversationId.toLowerCase());
  }

  @Post('conversations/:conversationId/games/caro')
  @HttpCode(200)
  create(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) conversationId: string,
  ) {
    return this.games.create(user.id, conversationId.toLowerCase(), 'caro');
  }

  @Post('conversations/:conversationId/games')
  @HttpCode(200)
  createGame(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) conversationId: string,
    @Body() input: CreateGameDto,
  ) {
    return this.games.create(
      user.id,
      conversationId.toLowerCase(),
      input.gameType,
    );
  }

  @Post('games/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.games.accept(user.id, id.toLowerCase());
  }
  @Post('games/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.games.decline(user.id, id.toLowerCase());
  }
  @Post('games/:id/moves')
  @HttpCode(200)
  move(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Body() input: GameMoveDto,
  ) {
    return this.games.move(user.id, id.toLowerCase(), input.cell, input.from);
  }
  @Post('games/:id/forfeit')
  @HttpCode(200)
  forfeit(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.games.forfeit(user.id, id.toLowerCase());
  }

  @Post('games/:id/timeout')
  @HttpCode(200)
  timeout(@CurrentUser() user: User, @Param('id', uuid()) id: string) {
    return this.games.timeout(user.id, id.toLowerCase());
  }
}
