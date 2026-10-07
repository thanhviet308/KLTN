import {
  Body,
  Controller,
  Get,
  Delete,
  Patch,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
import { MessagesService } from './messages.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO runtime metadata.
import {
  SendMessageDto,
  MessageHistoryDto,
  MessageReceiptDto,
  EditMessageDto,
} from './messages.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO runtime metadata.
import { PageDto } from '../../common/page.dto';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller('conversations/:conversationId')
export class MessagesController {
  constructor(
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {}

  @Post('messages')
  @HttpCode(200)
  send(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Body() input: SendMessageDto,
  ) {
    return this.messages.send(user.id, id.toLowerCase(), input);
  }

  @Get('messages')
  history(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Query() input: MessageHistoryDto,
  ) {
    return this.messages.history(user.id, id.toLowerCase(), input);
  }

  @Post('messages/delivered')
  @HttpCode(200)
  delivered(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Body() input: MessageReceiptDto,
  ) {
    return this.messages.receipt(
      user.id,
      id.toLowerCase(),
      input.messageId,
      false,
    );
  }

  @Post('messages/read')
  @HttpCode(200)
  read(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Body() input: MessageReceiptDto,
  ) {
    return this.messages.receipt(
      user.id,
      id.toLowerCase(),
      input.messageId,
      true,
    );
  }

  @Get('messages/:messageId/receipts')
  receipts(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
    @Query() input: PageDto,
  ) {
    return this.messages.receipts(
      user.id,
      id.toLowerCase(),
      messageId.toLowerCase(),
      input,
    );
  }

  @Get('messages/:messageId')
  get(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
  ) {
    return this.messages.get(
      user.id,
      id.toLowerCase(),
      messageId.toLowerCase(),
    );
  }

  @Patch('messages/:messageId')
  edit(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
    @Body() input: EditMessageDto,
  ) {
    return this.messages.edit(
      user.id,
      id.toLowerCase(),
      messageId.toLowerCase(),
      input,
    );
  }

  @Delete('messages/:messageId')
  remove(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
  ) {
    return this.messages.remove(
      user.id,
      id.toLowerCase(),
      messageId.toLowerCase(),
    );
  }
}
