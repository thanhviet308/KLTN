import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatFilesService } from '../messages/chat-files.service';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { ReportsService } from './reports.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Validation metadata.
import { CreateReportDto, ReviewReportDto } from './reports.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Validation metadata.
import { PageDto } from '../../common/page.dto';

@Controller()
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ChatFilesService) private readonly files: ChatFilesService,
  ) {}
  @Post('reports')
  create(@CurrentUser() user: User, @Body() input: CreateReportDto) {
    return this.reports.create(user.id, input);
  }
  @Get('admin/reports')
  queue(@CurrentUser() user: User, @Query() input: PageDto) {
    return this.reports.queue(user, input);
  }
  @Patch('admin/reports/:id')
  review(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ReviewReportDto,
  ) {
    return this.reports.review(user, id, input);
  }
  @Get('admin/reports/:id/image')
  async image(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const attachment = await this.reports.image(user, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(await this.files.stream(attachment.objectKey), {
      type: attachment.mimeType,
      disposition: 'inline',
      length: Number(attachment.size),
    });
  }
}

@Module({
  imports: [ConversationsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ChatFilesService],
})
export class ReportsModule {}
