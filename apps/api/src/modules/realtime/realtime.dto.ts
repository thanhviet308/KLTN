import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { MessageHistoryDto, SendMessageDto } from '../messages/messages.dto';

export class PresenceSocketDto {
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}

export class ConversationSocketDto {
  @IsUUID('4')
  conversationId!: string;
}

export class SendSocketDto extends SendMessageDto {
  @IsUUID('4')
  conversationId!: string;
}

export class SyncSocketDto extends MessageHistoryDto {
  @IsUUID('4')
  conversationId!: string;
}

export class ReceiptSocketDto extends ConversationSocketDto {
  @IsUUID('4')
  messageId!: string;
}

export class TypingSocketDto extends ConversationSocketDto {
  @IsBoolean()
  typing!: boolean;
}
