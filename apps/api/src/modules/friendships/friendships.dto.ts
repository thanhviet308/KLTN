import { IsIn, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { PageDto } from '../../common/page.dto';

export class CreateFriendRequestDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  recipientId!: string;
}

export class RespondFriendRequestDto {
  @IsIn(['accept', 'reject', 'cancel'])
  action!: 'accept' | 'reject' | 'cancel';
}

export class FriendRequestsQueryDto extends PageDto {
  @IsIn(['incoming', 'outgoing'])
  direction: 'incoming' | 'outgoing' = 'incoming';
}
