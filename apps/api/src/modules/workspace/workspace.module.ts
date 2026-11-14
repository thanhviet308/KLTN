import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthRequest } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { RealtimeEventsModule } from '../realtime/realtime-events.module';
import { AccountsService } from './accounts.service';
import { WorkspaceService } from './workspace.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Runtime validation metadata.
import {
  AccountRoleDto,
  AccountStatusDto,
  AdminAuditLogsDto,
  AdminDashboardDto,
  AdminUsersDto,
  CreatePollDto,
  RetentionPolicyDto,
  SearchMessagesDto,
  VoteDto,
} from './workspace.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Runtime validation metadata.
import { PageDto } from '../../common/page.dto';
const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller()
class WorkspaceController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
  ) {}
  @Get('admin/dashboard') @Roles('admin') dashboard(
    @CurrentUser() user: User,
    @Query() input: AdminDashboardDto,
  ) {
    return this.accounts.dashboard(user, input);
  }
  @Get('admin/users') @Roles('admin') users(
    @CurrentUser() user: User,
    @Query() input: AdminUsersDto,
  ) {
    return this.accounts.users(user, input);
  }
  @Get('admin/users/:id/overview') @Roles('admin') userOverview(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
  ) {
    return this.accounts.userOverview(user, id);
  }
  @Patch('admin/users/:id/status') @Roles('admin') status(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Body() input: AccountStatusDto,
  ) {
    return this.accounts.status(user, id, input.status);
  }
  @Patch('admin/users/:id/role') @Roles('admin') role(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Body() input: AccountRoleDto,
  ) {
    return this.accounts.role(user, id, input.role);
  }
  @Delete('admin/content/:targetType/:id') @Roles('admin') deleteContent(
    @CurrentUser() user: User,
    @Param('targetType') targetType: 'message' | 'attachment',
    @Param('id', uuid()) id: string,
  ) {
    return this.accounts.deleteContent(user, targetType, id);
  }
  @Get('admin/audit-logs') @Roles('admin') auditLogs(
    @CurrentUser() user: User,
    @Query() input: AdminAuditLogsDto,
  ) {
    return this.accounts.auditLogs(user, input);
  }
  @Get('admin/users/:id/export') @Roles('admin') exportUserLog(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
  ) {
    return this.accounts.exportUserLog(user, id);
  }
  @Post('admin/compliance/retention') @Roles('admin') applyRetention(
    @CurrentUser() user: User,
    @Body() input: RetentionPolicyDto,
  ) {
    return this.accounts.applyRetention(user, input);
  }
  @Get('auth/sessions') sessions(@Req() request: AuthRequest) {
    return this.accounts.sessions(
      request.principal.user.id,
      request.principal.sessionId,
    );
  }
  @Delete('auth/sessions/:id') revoke(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
  ) {
    return this.accounts.revoke(user.id, id);
  }
  @Get('messages/search') search(
    @CurrentUser() user: User,
    @Query() input: SearchMessagesDto,
  ) {
    return this.workspace.search(user.id, input);
  }
  @Get('conversations/:id/pins') pins(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
  ) {
    return this.workspace.pins(user.id, id);
  }
  @Put('conversations/:id/pins/:messageId') pin(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
  ) {
    return this.workspace.pin(user.id, id, messageId, false);
  }
  @Delete('conversations/:id/pins/:messageId') unpin(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
  ) {
    return this.workspace.pin(user.id, id, messageId, true);
  }
  @Get('conversations/:id/polls') polls(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Query() input: PageDto,
  ) {
    return this.workspace.polls(user.id, id, input);
  }
  @Post('conversations/:id/polls') createPoll(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Body() input: CreatePollDto,
  ) {
    return this.workspace.createPoll(user.id, id, input);
  }
  @Put('conversations/:id/polls/:pollId/vote') vote(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Param('pollId', uuid()) pollId: string,
    @Body() input: VoteDto,
  ) {
    return this.workspace.vote(user.id, id, pollId, input);
  }
  @Post('conversations/:id/polls/:pollId/close') close(
    @CurrentUser() user: User,
    @Param('id', uuid()) id: string,
    @Param('pollId', uuid()) pollId: string,
  ) {
    return this.workspace.closePoll(user.id, id, pollId);
  }
}
@Module({
  imports: [ConversationsModule, MessagesModule, RealtimeEventsModule],
  controllers: [WorkspaceController],
  providers: [AccountsService, WorkspaceService],
})
export class WorkspaceModule {}
