import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO metadata is required by ValidationPipe.
import { SaveNoteDto } from './notes.dto';
import { NotesService } from './notes.service';

@Controller('notes')
export class NotesController {
  constructor(@Inject(NotesService) private readonly notes: NotesService) {}
  @Get() list(@CurrentUser() user: User) {
    return this.notes.list(user.id);
  }
  @Get('music/search') searchMusic(@Query('q') q?: string) {
    return this.notes.searchMusic(q ?? '');
  }
  @Put('me') save(@CurrentUser() user: User, @Body() input: SaveNoteDto) {
    return this.notes.save(user.id, input);
  }
  @Delete('me') @HttpCode(204) remove(@CurrentUser() user: User) {
    return this.notes.remove(user.id);
  }
}
