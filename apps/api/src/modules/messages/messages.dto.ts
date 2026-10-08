import { Type, Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsDefined,
  IsOptional,
  ValidateNested,
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

export class MessageReactionDto {
  @IsIn(['👍', '❤️', '😂', '😮', '😢', '😡'])
  emoji!: string;
}

export class LocationDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class UploadMessageDto {
  @IsUUID('4')
  clientMessageId!: string;

  @IsString()
  @Length(1, 255)
  // Reject control bytes and path separators in user-visible filenames.
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\x00-\x1f\x7f/\\]+$/)
  fileName!: string;

  @IsIn(['image', 'file', 'voice'])
  type!: 'image' | 'file' | 'voice';

  @IsOptional()
  @IsString()
  @Length(1, 127)
  mimeType?: string;
}

export class SendMessageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  clientMessageId!: string;

  @IsIn(['text', 'location'])
  type: 'text' | 'location' = 'text';

  @ValidateIf((value: SendMessageDto) => value.type === 'text')
  @IsString()
  @Length(1, 10000)
  @Matches(/\S/)
  body?: string;

  @ValidateIf((value: SendMessageDto) => value.type === 'location')
  @IsDefined()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
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
