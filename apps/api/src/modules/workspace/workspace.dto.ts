import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
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
export class AdminUsersDto extends PageDto {
  @IsOptional() @IsString() @Length(0, 100) query?: string;
}
export class AccountStatusDto {
  @IsIn(['active', 'blocked']) status!: 'active' | 'blocked';
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
