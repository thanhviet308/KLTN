import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class SendMessageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  clientMessageId!: string;

  @IsIn(['text'])
  type = 'text' as const;

  @IsString()
  @Length(1, 10000)
  @Matches(/\S/)
  body!: string;
}

export class MessageHistoryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsIn(['backward', 'forward'])
  direction: 'backward' | 'forward' = 'backward';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 19)
  @Matches(/^(0|[1-9]\d*)$/)
  cursor?: string;
}

export class MessageReceiptDto {
  @IsUUID('4')
  messageId!: string;
}

export class EditMessageDto {
  @IsString()
  @Length(1, 10000)
  @Matches(/\S/)
  body!: string;

  // Required: null for an unedited message, otherwise its exact editedAt value.
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expectedEditedAt!: string | null;
}
