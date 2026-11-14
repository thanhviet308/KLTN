import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageDto } from '../../common/page.dto';

export class SearchMessagesDto extends PageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  query!: string;
  @IsOptional() @IsUUID('4') conversationId?: string;
}
export class AdminDashboardDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(90)
  days = 14;
}
export class AdminUsersDto extends PageDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, 100)
  query?: string;

  @IsOptional()
  @IsIn(['active', 'blocked', 'deleted'])
  status?: 'active' | 'blocked' | 'deleted';

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';
}
export class AccountStatusDto {
  @IsIn(['active', 'blocked', 'deleted'])
  status!: 'active' | 'blocked' | 'deleted';
}
export class AccountRoleDto {
  @IsIn(['user', 'admin'])
  role!: 'user' | 'admin';
}
export class AdminAuditLogsDto extends PageDto {
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @IsOptional()
  @IsIn(['user', 'report', 'message', 'attachment', 'call', 'conversation'])
  targetType?: string;

  @IsOptional()
  @IsUUID('4')
  targetId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(80)
  action?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
export class RetentionPolicyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(3650)
  days!: number;

  @IsIn(['messages', 'attachments', 'both'])
  scope!: 'messages' | 'attachments' | 'both';
}
export class CreatePollDto {
  @IsUUID('4') clientRequestId!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 300)
  question!: string;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 150, { each: true })
  options!: string[];
  @IsBoolean() multiple = false;
}
export class VoteDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(9, { each: true })
  options!: number[];
}
export class ForwardDto {
  @IsUUID('4') conversationId!: string;
  @IsUUID('4') clientMessageId!: string;
}
