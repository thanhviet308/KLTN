import {
  Controller,
  Get,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- ValidationPipe metadata.
import { PageDto } from '../../common/page.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly service: NotificationsService,
  ) {}
  @Get()
  list(@CurrentUser() user: User, @Query() input: PageDto) {
    return this.service.list(user.id, input);
  }
  @Patch('read-all')
  readAll(@CurrentUser() user: User) {
    return this.service.read(user.id);
  }
  @Patch(':id/read')
  read(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.read(user.id, id);
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
