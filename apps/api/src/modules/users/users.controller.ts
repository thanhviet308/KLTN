import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Patch,
  Query,
  Delete,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO classes required at runtime.
import { SearchUsersDto, UpdateProfileDto, UpdateAvatarDto } from './users.dto';
import { CurrentUser, Public } from '../auth/auth.decorators';
import type { Response } from 'express';
import type { User } from '../database/entities/user.entity';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  @Patch('me/avatar')
  updateAvatar(@CurrentUser() user: User, @Body() input: UpdateAvatarDto) {
    return this.users.updateAvatar(user.id, input.image);
  }
  @Delete('me/avatar')
  removeAvatar(@CurrentUser() user: User) {
    return this.users.updateAvatar(user.id, null);
  }
  @Public()
  @Get('avatars/:version')
  async avatar(
    @Param('version', new ParseUUIDPipe({ version: '4' })) version: string,
    @Res() response: Response,
  ) {
    const data = await this.users.avatar(version);
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.send(data);
  }
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: User) {
    return this.users.getCurrentProfile(user);
  }

  @Patch('me')
  update(@CurrentUser() user: User, @Body() input: UpdateProfileDto) {
    return this.users.updateProfile(user.id, input);
  }

  @Get()
  search(@CurrentUser() user: User, @Query() input: SearchUsersDto) {
    return this.users.search(user.id, input);
  }
}
