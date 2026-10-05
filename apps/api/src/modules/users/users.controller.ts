import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Patch,
  Query,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO classes required at runtime.
import { SearchUsersDto, UpdateProfileDto } from './users.dto';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
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
