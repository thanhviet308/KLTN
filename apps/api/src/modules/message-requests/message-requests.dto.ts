import { Transform } from 'class-transformer';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PageDto } from '../../common/page.dto';

export class CreateMessageRequestDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  recipientId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class MessageRequestsQueryDto extends PageDto {
  @IsIn(['incoming', 'outgoing', 'all'])
  direction: 'incoming' | 'outgoing' | 'all' = 'incoming';
}

export class RespondMessageRequestDto {
  @IsIn(['accept', 'reject', 'cancel'])
  action!: 'accept' | 'reject' | 'cancel';
}
