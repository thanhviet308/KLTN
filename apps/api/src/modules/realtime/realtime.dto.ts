import { IsBoolean, IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
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

export class WebRtcJoinSocketDto {
  @IsUUID('all')
  callId!: string;

  @IsOptional()
  @IsBoolean()
  audioEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  videoEnabled?: boolean;
}

export class WebRtcLeaveSocketDto {
  @IsUUID('all')
  callId!: string;
}

export class WebRtcMediaStateSocketDto {
  @IsUUID('all')
  callId!: string;

  @IsBoolean()
  audioEnabled!: boolean;

  @IsBoolean()
  videoEnabled!: boolean;
}

export class WebRtcSignalSocketDto {
  @IsUUID('all')
  callId!: string;

  @IsUUID('all')
  targetUserId!: string;

  @IsIn(['offer', 'answer', 'ice-candidate'])
  type!: 'offer' | 'answer' | 'ice-candidate';

  @IsObject()
  payload!: Record<string, unknown>;
}
