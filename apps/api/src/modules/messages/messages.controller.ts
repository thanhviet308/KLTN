import {
  Body,
  Req,
  Res,
  StreamableFile,
  Controller,
  Get,
  Delete,
  Patch,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { User } from '../database/entities/user.entity';
import type { Request, Response } from 'express';
import { ChatFilesService } from './chat-files.service';
import { MessagesService } from './messages.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO runtime metadata.
import {
  SendMessageDto,
  MessageHistoryDto,
  MessageReceiptDto,
  EditMessageDto,
  MessageReactionDto,
  UploadMessageDto,
} from './messages.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTO runtime metadata.
import { PageDto } from '../../common/page.dto';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller('conversations/:conversationId')
export class MessagesController {
  @Put('messages/:messageId/reaction')
  react(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
    @Body() input: MessageReactionDto,
  ) {
    return this.messages.react(
      user.id,
      id.toLowerCase(),
      messageId.toLowerCase(),
      input.emoji,
    );
  }

  @Delete('messages/:messageId/reaction')
  removeReaction(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
  ) {
    return this.messages.react(
      user.id,
      id.toLowerCase(),
      messageId.toLowerCase(),
      null,
    );
  }

  @Get('messages/:messageId/reactions')
  reactions(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
  ) {
    return this.messages.reactions(
      user.id,
      id.toLowerCase(),
      messageId.toLowerCase(),
    );
  }
  constructor(
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(ChatFilesService) private readonly files: ChatFilesService,
  ) {}

  @Post('messages/upload')
  @HttpCode(200)
  async upload(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Query() input: UploadMessageDto,
    @Req() request: Request,
  ) {
    id = id.toLowerCase();
    await this.messages.authorizeUpload(user.id, id);
    const media = await this.files.receive(request, input);
    try {
      const result = await this.messages.send(
        user.id,
        id,
        { clientMessageId: input.clientMessageId.toLowerCase(), type: 'text' },
        media,
      );
      if (result.message.content?.attachmentId !== media.id)
        await this.files.remove(media.id);
      return result;
    } catch (error) {
      await this.files.remove(media.id);
      throw error;
    }
  }

  @Get('messages/:messageId/file')
  async file(
    @CurrentUser() user: User,
    @Param('conversationId', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const attachment = await this.messages.attachment(
      user.id,
      id.toLowerCase(),
      messageId.toLowerCase(),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(await this.files.stream(attachment.objectKey), {
      type: attachment.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName).replace(/'/g, '%27')}`,
      length: Number(attachment.size),
    });
  }

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
